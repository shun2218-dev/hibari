import Image from "next/image";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import {
  AtSignIcon,
  PaperclipIcon,
  SearchIcon,
  SyncIcon,
  ThreadIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { LogoMark } from "@/components/ui/logo";
import { cx } from "@/lib/cx";
import { DOCS_URL, GITHUB_URL } from "@/lib/site";

// Storybook のチャットの画面（chat-timeline--default）を撮ったもの。`make lp-image` で撮り直す（tools/shoot-ui.mjs）
import channelScreenshot from "./channel.png";

/**
 * LP（`hibari-chat.com`。ADR 0063 決定 5 / 6）。デザインは Claude Design のキャンバスで、撮ったものが docs/ui/screenshots/lp/。
 *
 * ログインとアカウント作成などは別のホスト（`app.` やドキュメントサイト）にあるので、next/link ではなく素の a で移る。
 * LP はライトだけ（決定 6）。テーマの設定は `app.` の localStorage にあり、apex からは読めない。
 */
export function LandingPage({ appBaseUrl }: { appBaseUrl: URL }) {
  const loginUrl = new URL("/login", appBaseUrl).href;
  const signupUrl = new URL("/signup", appBaseUrl).href;
  return (
    <div className="flex min-h-dvh flex-col bg-background text-text">
      <header className="flex h-15 items-center justify-between px-4 md:h-18 md:px-16">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-text md:gap-2.5">
          <LogoMark className="size-7 md:size-8" />
          hibari
        </Link>
        <nav aria-label="メニュー" className="flex items-center gap-7">
          <a href={DOCS_URL} className="hidden text-base text-text-secondary hover:text-text md:inline">
            ドキュメント
          </a>
          <a href={GITHUB_URL} className="hidden text-base text-text-secondary hover:text-text md:inline">
            GitHub
          </a>
          {/* モバイルは押しやすいよう高さを 44px 取る */}
          <a
            href={loginUrl}
            className="inline-flex h-11 items-center px-3 text-base font-semibold text-text md:h-auto md:px-0"
          >
            ログイン
          </a>
          <a
            href={signupUrl}
            className="hidden h-10 items-center rounded-md bg-primary px-4 text-base font-semibold text-on-primary hover:bg-primary-hover md:inline-flex"
          >
            はじめる
          </a>
        </nav>
      </header>

      <main className="flex flex-col">
        <section className="flex flex-col gap-5 px-4 pt-10 md:items-center md:gap-7 md:px-16 md:pt-18 md:text-center">
          <h1 className="text-display-sm leading-tight font-bold md:text-display md:tracking-tight">
            ワークスペースとチャンネルで話す、
            <br className="hidden md:inline" />
            リアルタイムチャット。
          </h1>
          <p className="max-w-160 text-lg leading-relaxed text-text-secondary">
            チームごとにワークスペースを作り、話題ごとにチャンネルを分ける。メッセージはその場で届き、接続が切れても取りこぼさない。
          </p>
          <div className="flex flex-col gap-3 md:flex-row">
            <CallToAction href={signupUrl} variant="primary">
              アカウントを作成
            </CallToAction>
            <CallToAction href={loginUrl} variant="secondary">
              ログイン
            </CallToAction>
          </div>
          <Image
            src={channelScreenshot}
            alt="hibari のチャンネルの画面"
            // 撮った大きさ（Storybook の画面の既定。1280x800）。テスト（Vitest）では import が文字列になり、大きさを読めないので書いておく
            width={1280}
            height={800}
            // 最初に目に入る画像なので、遅延読み込みにしない
            preload
            sizes="(min-width: 768px) 1040px, 100vw"
            className="mt-3 w-full rounded-md border border-border md:mt-6 md:max-w-260 md:rounded-lg md:shadow-showcase"
          />
        </section>

        <section className="flex flex-col gap-5 px-4 pt-14 md:gap-8 md:px-30 md:pt-24">
          <h2 className="text-xl font-bold md:text-2xl">チャットに要るものを、ひととおり</h2>
          <ul className="grid gap-5 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <Feature key={feature.title} {...feature} />
            ))}
          </ul>
        </section>

        <section className="mx-4 mt-14 flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 md:mx-30 md:mt-24 md:flex-row md:items-center md:justify-between md:gap-8 md:px-12 md:py-10">
          <div className="flex flex-col gap-4 md:gap-2">
            <h2 className="text-xl font-bold">設計を公開しています</h2>
            <p className="text-lg leading-relaxed text-text-secondary">
              Go と WebSocket で、なぜこう作ったのか。判断はすべて ADR に残し、REST の API リファレンスと一緒に読めます。
            </p>
          </div>
          <CallToAction href={DOCS_URL} variant="secondary">
            ドキュメントを読む
          </CallToAction>
        </section>
      </main>

      <footer className="mt-14 flex flex-col gap-4 border-t border-border px-4 py-8 md:mt-24 md:flex-row md:items-center md:justify-between md:px-30">
        <p className="flex items-center gap-2 text-base font-bold">
          <LogoMark className="size-5" />
          hibari
        </p>
        <nav aria-label="フッター" className="flex gap-6">
          <FooterLink href={DOCS_URL}>ドキュメント</FooterLink>
          <FooterLink href={GITHUB_URL}>GitHub</FooterLink>
        </nav>
      </footer>
    </div>
  );
}

type FeatureProps = { Icon: ComponentType<{ className?: string }>; title: string; body: string };

const FEATURES: FeatureProps[] = [
  {
    Icon: SyncIcon,
    title: "すぐ届いて、落とさない",
    body: "メッセージは WebSocket で届く。接続が切れても、再接続したときに取りこぼした分を取り戻す。",
  },
  {
    Icon: ThreadIcon,
    title: "スレッドで話を分ける",
    body: "返信はスレッドにまとめ、チャンネルの流れを止めない。必要な返信だけチャンネルにも出せる。",
  },
  {
    Icon: AtSignIcon,
    title: "メンションと通知",
    body: "@ で相手を呼び、自分宛てのものはアクティビティにまとまる。チャンネルごとに通知を選べる。",
  },
  {
    Icon: SearchIcon,
    title: "過去の会話を探せる",
    body: "日本語で検索でき、チャンネルや送信者で絞り込める。見つけたメッセージにそのまま飛べる。",
  },
  {
    Icon: PaperclipIcon,
    title: "ファイルを添付できる",
    body: "画像はその場で見られ、ファイルはストレージから直接やり取りする。",
  },
  {
    Icon: UsersIcon,
    title: "DM と、いまいる人",
    body: "2 人だけの会話と、オンラインかどうかの表示。離席やステータスも自分で決められる。",
  },
];

function Feature({ Icon, title, body }: FeatureProps) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6">
      <span className="flex size-11 items-center justify-center rounded-md bg-primary-subtle text-primary">
        <Icon className="size-6" />
      </span>
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="text-lg leading-relaxed text-text-secondary">{body}</p>
    </li>
  );
}

/** LP の大きいボタン（高さ 48px）。遷移するので a にする。アプリの Button（lg は 44px の全幅）とは大きさが違う。 */
function CallToAction({
  href,
  variant,
  children,
}: {
  href: string;
  variant: "primary" | "secondary";
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cx(
        "inline-flex h-12 shrink-0 items-center justify-center rounded-md px-6 text-lg font-semibold",
        variant === "primary"
          ? "bg-primary text-on-primary hover:bg-primary-hover"
          : "border border-border bg-surface text-text hover:bg-surface-muted",
      )}
    >
      {children}
    </a>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    // モバイルは押しやすいよう高さを 44px 取る
    <a href={href} className="inline-flex min-h-11 items-center text-sm text-text-muted hover:text-text md:min-h-0">
      {children}
    </a>
  );
}
