// Package mail はメールの送信を抽象化する（ADR 0053）。
//
// 送るのは SMTP だけにして、特定の業者の SDK や API に依存しない。どの業者も SMTP で受け付けるので、
// 業者を替えるときは設定（接続先と認証情報）だけを変えれば済む（CLAUDE.md ルール 10 のストレージと同じ考え方）。
//
// 文面を組み立てるのはドメイン（auth）の役目で、ここは届けることだけを受け持つ。
package mail

import "context"

// Message は 1 通のメール。本文はプレーンテキストだけにする。
// hibari が送るのは確認と再設定のリンクだけで、HTML にする理由がない（リンクを書き換える追跡も入れない）。
type Message struct {
	To      string
	Subject string
	Body    string
	// Kind はログに出すためのメールの種類（例: "email_verification"）。宛先や本文はログに出さないので、失敗を見分ける手がかりにする。
	Kind string
}

// Sender は Message を送る。
type Sender interface {
	Send(ctx context.Context, m Message) error
}
