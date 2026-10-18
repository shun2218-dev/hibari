import type { PasswordStrength } from "@/components/ui/field";

/**
 * 入力中のパスワードの強さを、長さだけで見積もる。
 *
 * サーバーは文字種の組み合わせを強制しない（NIST SP 800-63B。ADR 0010）ので、
 * 「記号を入れると強くなる」ような表示にすると、サーバーの規則と違うことを促してしまう。
 * 辞書に載った語の検出（zxcvbn など）は依存が大きいので入れない。
 *
 * 数え方はサーバーと同じコードポイント単位にする（下限 8 文字）。
 */
export function passwordStrength(password: string): PasswordStrength | undefined {
  const length = [...password].length;
  if (length === 0) return undefined;
  if (length < 8) return { level: 1, label: "短すぎます" };
  if (length < 12) return { level: 2, label: "ふつう" };
  if (length < 16) return { level: 3, label: "良い" };
  return { level: 4, label: "強い" };
}
