import { safeNextPath } from "@/lib/auth/next-path";

import { SignupPage } from "@/app/(auth)/signup/_components/signup-page";

export const metadata = { title: "アカウントを作成 | hibari" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <SignupPage next={safeNextPath(next)} />;
}
