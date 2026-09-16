import { AuthShell, StatusContent } from "@/components/auth/auth-shell";
import { Note } from "@/components/ui/alert";
import { Button, TextButton } from "@/components/ui/button";
import { UsersIcon } from "@/components/ui/icons";

/**
 * 所属するワークスペースが 1 つもない（招待なしで登録した直後など）。
 *
 * サイドバーに出すものがないので、チャットの画面ではなく認証と同じカードで出す。
 * 招待リンクから登録した人は受け入れの画面に戻るので、ここには来ない。
 */
export function NoWorkspaces({ onCreate, onLogout }: { onCreate?: () => void; onLogout?: () => void }) {
  return (
    <AuthShell
      footer={
        <>
          別のアカウントで開きますか？ <TextButton onClick={onLogout}>ログアウト</TextButton>
        </>
      }
    >
      <StatusContent
        tone="neutral"
        icon={<UsersIcon className="size-5" />}
        title="まだワークスペースがありません"
        description="ワークスペースを作成して、メンバーを招待しましょう。"
      >
        <Note>招待されている場合は、届いた招待リンクを開くと参加できます。</Note>
        <Button size="lg" onClick={onCreate}>
          ワークスペースを作成
        </Button>
      </StatusContent>
    </AuthShell>
  );
}
