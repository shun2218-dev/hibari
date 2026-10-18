/** 署名付き URL へのアップロード。進み具合を 0〜1 で知らせる。 */
export type PutFile = (
  url: string,
  headers: Record<string, string>,
  file: Blob,
  options: { onProgress: (ratio: number) => void; signal: AbortSignal },
) => Promise<void>;

export class UploadAbortedError extends Error {
  constructor() {
    super("upload aborted");
    this.name = "UploadAbortedError";
  }
}

/**
 * ストレージに直接 PUT する（中身は Go サーバーを経由しない。CLAUDE.md ルール 10）。
 *
 * fetch はアップロードの進み具合を取れないので XMLHttpRequest を使う。
 * Authorization は付けない（署名が URL に入っている。Access Token をストレージに渡さない）。
 * Content-Length はブラウザが本文から付ける（署名に含まれていて、申告と違えばストレージが 403 で拒否する。ADR 0013）。
 */
export const putFileWithXhr: PutFile = (url, headers, file, { onProgress, signal }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      // 本文（S3 の XML）には署名の情報が含まれうるので、エラーに入れない
      else reject(new Error(`upload responded ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.onabort = () => reject(new UploadAbortedError());
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
