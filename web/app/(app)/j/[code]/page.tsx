import { InvitePage } from "@/app/(app)/j/[code]/_components/invite-page";

// ワークスペース名は入れない。プレビューは要ログインで、URL を知っているだけの人に中身を見せない（ADR 0063 決定 2、ADR 0011）
export const metadata = { title: "ワークスペースへの招待" };

/** 招待リンク（`/j/{code}`）。プレビューは要ログインなので、(app) の中に置いて振り分けに乗せる（ADR 0011 / 0030）。 */
export default function Page() {
  return <InvitePage />;
}
