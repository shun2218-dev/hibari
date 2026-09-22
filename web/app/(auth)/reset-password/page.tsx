import { ResetPasswordPage } from "@/app/(auth)/reset-password/_components/reset-password-page";

export const metadata = {
  title: "新しいパスワードを設定 | hibari",
  // URL に再設定のトークンが載っている。ページから出ていくリクエストに Referer で付けない。
  referrer: "no-referrer",
} as const;

/** メールのリンク（`/reset-password?token=...`、internal/auth の link）の受け口。 */
export default async function Page({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  return <ResetPasswordPage token={typeof token === "string" ? token : ""} />;
}
