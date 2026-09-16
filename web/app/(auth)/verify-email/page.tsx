import { VerifyEmailPage } from "./verify-email-page";

export const metadata = {
  title: "メールアドレスの確認 | hibari",
  // URL に確認のトークンが載っている。ページから出ていくリクエストに Referer で付けない。
  referrer: "no-referrer",
} as const;

/** メールのリンク（`/verify-email?token=...`、internal/auth の link）の受け口。 */
export default async function Page({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;
  return <VerifyEmailPage token={typeof token === "string" ? token : ""} />;
}
