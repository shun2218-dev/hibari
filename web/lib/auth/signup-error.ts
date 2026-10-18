import { ApiError } from "@/lib/api/error";

/** 登録の入力エラーの文言。項目と reason はサーバーの検証（internal/auth/validate.go）に合わせる。 */
export const fieldMessages: Record<string, Record<string, string>> = {
  display_name: {
    required: "表示名を入力してください。",
    too_long: "表示名は50文字以内にしてください。",
    invalid_format: "表示名に使えない文字が含まれています。",
  },
  handle: {
    required: "ハンドルを入力してください。",
    invalid_format: "ハンドルは3〜32文字の半角英数字と _ で入力してください。",
  },
  email: {
    required: "メールアドレスを入力してください。",
    too_long: "メールアドレスの形式が正しくありません。",
    invalid_format: "メールアドレスの形式が正しくありません。",
  },
  password: {
    required: "パスワードを入力してください。",
    too_short: "パスワードは8文字以上にしてください。",
    too_long: "パスワードは128文字以内にしてください。",
    invalid_format: "パスワードに使えない文字が含まれています。",
  },
};

/** フォームの並びと同じ順に出す。 */
const fieldOrder = ["display_name", "handle", "email", "password"];

/**
 * 登録の失敗を、SignupForm の `error` に出す文言にする。
 * 入力やアカウントの問題でないもの（通信の失敗、500）は undefined を返し、呼び出し側に任せる。
 *
 * 登録では email が使われていることを明かす（ADR 0010。IP 単位の回数制限で列挙のコストを上げている）。
 */
export function signupErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  switch (err.type) {
    case "email-taken":
      return "このメールアドレスはすでに登録されています。";
    case "handle-taken":
      return "このハンドルはすでに使われています。";
    case "rate-limited":
      return "登録の試行が多すぎます。しばらく時間をおいてから再度お試しください。";
    case "validation-error": {
      const messages = [...err.fieldErrors]
        .sort((a, b) => fieldOrder.indexOf(a.field) - fieldOrder.indexOf(b.field))
        .map((e) => fieldMessages[e.field]?.[e.reason])
        .filter((m): m is string => m !== undefined);
      return messages.length > 0 ? messages.join("") : undefined;
    }
    default:
      return undefined;
  }
}
