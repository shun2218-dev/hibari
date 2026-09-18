import { InvitePage } from "./invite-page";

/** 招待リンク（`/j/{code}`）。プレビューは要ログインなので、(app) の中に置いて振り分けに乗せる（ADR 0011 / 0030）。 */
export default function Page() {
  return <InvitePage />;
}
