import { safeNextPath } from "@/lib/auth/next-path";

import { LoginPage } from "@/app/(auth)/login/_components/login-page";

export const metadata = { title: "ログイン" };

export default async function Page({ searchParams }: PageProps<"/login">) {
  // useSearchParams ではなく props で受け取り、クライアントに渡す前に外部の URL を落とす。
  const { next } = await searchParams;
  return <LoginPage next={safeNextPath(next)} />;
}
