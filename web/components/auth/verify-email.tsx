import { Button } from "@/components/ui/button";
import { AlertIcon, CheckCircleIcon, MailIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";

import { StatusContent } from "./auth-shell";

/**
 * 登録直後と、確認するまで chat を使えない間（ADR 0053 決定 3）。メールの確認は「いま待っていること」なので琥珀にする。
 */
export function VerifyEmailPending({
  email,
  resending,
  onResend,
  onChangeEmail,
  onLogout,
}: {
  email: string;
  resending?: boolean;
  onResend?: () => void;
  /** email を変える API がまだないので、渡さなければ「別のアドレスに変更する」を出さない。 */
  onChangeEmail?: () => void;
  /**
   * 確認するまで chat を使えないので、この画面から別のアカウントに移れるようにする（ADR 0053 決定 3）。
   * 「別のアドレスに変更する」と同じ補助のリンクの形にする。
   */
  onLogout?: () => void;
}) {
  return (
    <StatusContent
      tone="attention"
      icon={<MailIcon className="size-5" />}
      title="確認メールを送りました"
      description={
        <>
          <span className="font-mono text-text">{email}</span> 宛のメールにあるリンクを開くと、確認が完了します。
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <Button variant="primary-outline" size="lg" onClick={onResend} disabled={resending}>
          確認メールを再送する
        </Button>
        {onChangeEmail && (
          <button type="button" onClick={onChangeEmail} className="text-xs font-medium text-primary hover:underline">
            別のアドレスに変更する
          </button>
        )}
        {onLogout && (
          <button type="button" onClick={onLogout} className="text-xs font-medium text-primary hover:underline">
            ログアウト
          </button>
        )}
      </div>
    </StatusContent>
  );
}

/** リンクを開いてから結果が返るまで。開いたらすぐ確認するので、操作は置かない。 */
export function VerifyEmailChecking() {
  return <StatusContent tone="neutral" icon={<Spinner className="size-5" />} title="メールアドレスを確認しています" />;
}

export function VerifyEmailDone({ onOpen }: { onOpen?: () => void }) {
  return (
    <StatusContent
      tone="primary"
      icon={<CheckCircleIcon className="size-5" />}
      title="メールアドレスを確認しました"
      description="これで hibari のすべての機能が使えます。"
    >
      <Button size="lg" onClick={onOpen}>
        hibari を開く
      </Button>
    </StatusContent>
  );
}

export function VerifyEmailInvalid({ resending, onResend }: { resending?: boolean; onResend?: () => void }) {
  return (
    <StatusContent
      tone="neutral"
      icon={<AlertIcon className="size-5" />}
      title="確認リンクが無効です"
      description="リンクの有効期限が切れたか、すでに使われています。確認メールを送り直してください。"
    >
      <Button size="lg" onClick={onResend} disabled={resending}>
        確認メールを再送する
      </Button>
    </StatusContent>
  );
}
