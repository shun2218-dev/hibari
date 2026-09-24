// Package storage は S3 API のオブジェクトストレージへのアクセスを抽象化する（ADR 0008）。
//
// 使う操作は署名付き URL の発行（PUT / GET）、HEAD、DELETE だけに絞る。S3 互換のストレージ（RustFS、R2 など）は
// 互換性が完全ではないので、それ以外の機能（ACL、presigned POST、バケットの作成など）に依存しない。
// ファイルの中身はサーバーを経由させない（CLAUDE.md ルール 10）ので、GET / PUT そのものは持たない。
package storage

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// ErrNotFound はオブジェクトが存在しないことを表す。
var ErrNotFound = errors.New("storage: object not found")

// Config は S3 API の接続先。
type Config struct {
	// Endpoint はサーバーが HEAD / DELETE に使う URL（例: http://s3:9000）。
	Endpoint string
	// PublicEndpoint は署名付き URL に使う URL（例: http://localhost:9000）。空なら Endpoint。
	// 署名にはホスト名が含まれるので、クライアントから到達できるホスト名で署名しないと、URL が使えない（ADR 0013）。
	PublicEndpoint  string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	// UsePathStyle は、バケット名をホスト名ではなくパスに入れるか。ローカルの RustFS はホスト名のバケットを解決できないので true にする。
	UsePathStyle bool
}

// S3 は S3 API のクライアント。
type S3 struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

// New は S3 を返す。接続はしない（最初の操作で接続する）。
func New(cfg Config) (*S3, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.Region == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		return nil, errors.New("storage: endpoint, bucket, region and credentials are required")
	}
	publicEndpoint := cfg.PublicEndpoint
	if publicEndpoint == "" {
		publicEndpoint = cfg.Endpoint
	}
	for _, e := range []string{cfg.Endpoint, publicEndpoint} {
		if u, err := url.Parse(e); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("storage: endpoint must be an absolute http(s) URL, got %q", e)
		}
	}
	options := func(endpoint string) s3.Options {
		return s3.Options{
			Region:       cfg.Region,
			BaseEndpoint: aws.String(endpoint),
			UsePathStyle: cfg.UsePathStyle,
			Credentials:  credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
			// SDK は既定で CRC32 のチェックサムを付けて検証するが、S3 互換のストレージは対応していないことがある（ADR 0013）。
			RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
			ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
		}
	}
	return &S3{
		client: s3.New(options(cfg.Endpoint)),
		// 署名付き URL だけは公開エンドポイントで作る。署名は手元の計算だけで、ネットワークには出ない。
		presign: s3.NewPresignClient(s3.New(options(publicEndpoint))),
		bucket:  cfg.Bucket,
	}, nil
}

// PresignedRequest は、クライアントがストレージに直接送るリクエスト。
type PresignedRequest struct {
	Method string
	URL    string
	// Header はクライアントが付けなければならないヘッダー。値が違うと署名が合わずに拒否される。
	Header http.Header
}

// PresignPut は、ちょうど size バイトで Content-Type が contentType のオブジェクトだけを key に PUT できる URL を返す。
//
// Content-Length と Content-Type を署名に含めるので、申告と違う PUT はストレージが拒否する。
// サイズの「上限」ではなく「一致」で縛られる（R2 は presigned POST のポリシーに対応していないため。ADR 0008）。
func (s *S3) PresignPut(ctx context.Context, key, contentType string, size int64, ttl time.Duration) (PresignedRequest, error) {
	req, err := s.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(size),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return PresignedRequest{}, fmt.Errorf("storage: presign put: %w", err)
	}
	header := http.Header{}
	for k, vs := range req.SignedHeader {
		// Host と Content-Length も署名に含まれるが、HTTP クライアントが URL と本文から付ける。
		// ブラウザの fetch はこの 2 つを設定できないので、クライアントに渡すヘッダーからは除く。
		switch http.CanonicalHeaderKey(k) {
		case "Host", "Content-Length":
			continue
		}
		for _, v := range vs {
			header.Add(k, v)
		}
	}
	return PresignedRequest{Method: req.Method, URL: req.URL, Header: header}, nil
}

// GetOptions は署名付き GET URL のレスポンスのヘッダーの上書き。空なら上書きしない。
type GetOptions struct {
	ContentType        string
	ContentDisposition string
}

// PresignGet は key を GET できる URL を返す。
func (s *S3) PresignGet(ctx context.Context, key string, ttl time.Duration, opts GetOptions) (string, error) {
	in := &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)}
	if opts.ContentType != "" {
		in.ResponseContentType = aws.String(opts.ContentType)
	}
	if opts.ContentDisposition != "" {
		in.ResponseContentDisposition = aws.String(opts.ContentDisposition)
	}
	req, err := s.presign.PresignGetObject(ctx, in, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("storage: presign get: %w", err)
	}
	return req.URL, nil
}

// ObjectInfo は HEAD で得たオブジェクトの情報。
type ObjectInfo struct {
	Size        int64
	ContentType string
}

// Head はオブジェクトの情報を返す。オブジェクトがなければ ErrNotFound。
func (s *S3) Head(ctx context.Context, key string) (ObjectInfo, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		// HEAD のレスポンスには本文がないので、S3 のエラーコードではなく HTTP のステータスで判定する。
		var re *awshttp.ResponseError
		if errors.As(err, &re) && re.HTTPStatusCode() == http.StatusNotFound {
			return ObjectInfo{}, ErrNotFound
		}
		return ObjectInfo{}, fmt.Errorf("storage: head: %w", err)
	}
	return ObjectInfo{Size: aws.ToInt64(out.ContentLength), ContentType: aws.ToString(out.ContentType)}, nil
}

// Delete はオブジェクトを消す。オブジェクトがなくても成功する（S3 API の DELETE は冪等）。
func (s *S3) Delete(ctx context.Context, key string) error {
	if _, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)}); err != nil {
		return fmt.Errorf("storage: delete: %w", err)
	}
	return nil
}
