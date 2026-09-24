import { safeNextPath } from "@/lib/auth/next-path";

import { VerifyEmailPage } from "@/app/(auth)/verify-email/_components/verify-email-page";

export const metadata = {
  title: "メールアドレスの確認",
  // URL に確認のトークンが載っている。ページから出ていくリクエストに Referer で付けない。
  referrer: "no-referrer",
} as const;

/**
 * メールのリンク（`/verify-email?token=...&next=...`、internal/auth の link）の受け口。
 * `next` は検証のあとに進む先（ADR 0053 決定 3）。サーバーも検証しているが、ここでも同じオリジンのパスに絞る。
 */
export default async function Page({ searchParams }: PageProps<"/verify-email">) {
  const { token, next } = await searchParams;
  return <VerifyEmailPage token={typeof token === "string" ? token : ""} next={safeNextPath(next)} />;
}
