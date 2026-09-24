import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { LockIcon } from "@/components/ui/icons";
import { useChannelLinks } from "@/hooks/chat/use-channel-links";
import { useOrigin } from "@/hooks/use-origin";
import { type Block, type Inline, type ListBlock, parseBody } from "@/lib/chat/format/body-format";
import { type ChannelLinks } from "@/providers/channel-links-provider";
import { UNRESOLVED_CHANNEL_NAME } from "@/lib/chat/format/channel-links";
import { highlightParts } from "@/lib/chat/format/highlight";
import { parsePermalink, permalinkPath } from "@/lib/chat/format/links";

/**
 * メッセージの本文（ADR 0051）。`parseBody` の木を React の要素に写すだけで、HTML の文字列は作らない。
 * 本文の文字はすべて React のテキストとして出るので、`<script>` と書いても文字のまま見える（決定 3）。
 *
 * 色は `docs/ui/tokens.md` の決まりどおり。リンクと個人のチップは押せるものなので緑にする。
 * `@channel` / `@here` も個人と同じチップにする（ADR 0043 決定 3 の追記。オーナーの判断、2026-09-24）。押せないので、下線は出さない。
 * チャンネルへのリンク `<#ID>` も同じチップで、押すとそのチャンネルへ移る（ADR 0062 決定 3）。名前は画面の根が配る表から引く。
 *
 * 段落は改行をそのまま出す（`whitespace-pre-wrap`）。書式のない本文は段落 1 つになるので、いままでと同じ見た目になる。
 *
 * `interactive={false}` は、行全体が 1 つのリンクになっている所（スレッドの一覧）に置くとき。リンクやボタンを入れ子にできないので、
 * リンクとチップを同じ見た目の押せない要素で描く。
 */
export function MessageBody({
  body,
  mentionNames,
  onOpenProfile,
  trailing,
  interactive = true,
  highlight,
  className,
}: {
  body: string;
  mentionNames?: Readonly<Record<string, string>>;
  /** 個人のチップを押した（Phase 6.9）。渡さなければ押せない見た目のままにする。 */
  onOpenProfile?: (userId: string) => void;
  /** 本文の最後の行に続けて出すもの（「（編集済み）」）。最後が段落でなければ、本文の下に出す。 */
  trailing?: ReactNode;
  /** リンクとチップを押せる要素で描くか。行全体がリンクの所では false にする。 */
  interactive?: boolean;
  /** 検索で一致した部分をマーカーで塗る（ADR 0061 決定 7）。検索結果の 1 件だけで渡す。 */
  highlight?: readonly string[];
  className?: string;
}) {
  const origin = useOrigin();
  const channelLinks = useChannelLinks();
  const ctx: RenderContext = { names: mentionNames ?? {}, onOpenProfile, interactive, origin, highlight, channelLinks };
  const blocks = parseBody(body);
  const last = blocks.at(-1);
  const trailingInside = trailing !== undefined && last?.type === "paragraph";
  return (
    <div className={className}>
      <div className="space-y-1">
        {blocks.map((block, i) => (
          // ブロックは本文の位置でしか区別できないので、key は添字にする（並びが変わることはない）
          <BlockView key={i} block={block} ctx={ctx} trailing={trailingInside && i === blocks.length - 1 ? trailing : undefined} />
        ))}
      </div>
      {trailing !== undefined && !trailingInside && <div>{trailing}</div>}
    </div>
  );
}

type RenderContext = {
  names: Readonly<Record<string, string>>;
  onOpenProfile?: (userId: string) => void;
  interactive: boolean;
  /** パーマリンクを見分けるためのオリジン。サーバーでの描画では undefined で、そのときは普通のリンクとして描く。 */
  origin: string | undefined;
  /** 検索で一致した部分（ADR 0061 決定 7）。書式を解釈したあとの地の文にだけ重ねる。 */
  highlight?: readonly string[];
  /** 本文の `<#ID>` の名前とリンク先（ADR 0062）。 */
  channelLinks: ChannelLinks;
};

/**
 * 地の文のうち、検索で一致したところをマーカーで塗る。
 * `<mark>` を使うのは、読み上げにも「強調された箇所」として伝わるため。色はブラウザの既定を打ち消してトークンで塗る。
 */
function HighlightedText({ text, terms }: { text: string; terms: readonly string[] }) {
  return highlightParts(text, terms).map((part, i) =>
    part.hit ? (
      <mark key={i} className="bg-highlight text-text">
        {part.text}
      </mark>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    ),
  );
}

/** メンションのチップ。個人も `@channel` / `@here` も同じ見た目にする（ADR 0043 決定 3 の追記）。入力欄の mention-node.ts と揃える。 */
const MENTION_CHIP = "rounded-sm bg-primary-subtle px-1 font-semibold text-primary";

/** 箇条書きの記号は段ごとに • → ◦ → ▪（Slack と同じ。docs/ui/tokens.md）。段は 3 つまで（ADR 0051 決定 2）。 */
const BULLETS = ["list-disc", "list-circle", "list-square"] as const;

function BlockView({ block, ctx, trailing }: { block: Block; ctx: RenderContext; trailing?: ReactNode }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap">
          <Inlines nodes={block.children} ctx={ctx} />
          {trailing}
        </p>
      );
    case "code":
      return (
        // 書いたとおりに出す。折り返すと字下げが崩れて読めなくなるので、長い行は横にスクロールさせる
        <pre className="overflow-x-auto rounded-sm border border-border bg-surface-muted px-3 py-2 font-mono text-base leading-normal whitespace-pre text-text">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="space-y-1 border-l-4 border-border pl-3 text-text-secondary">
          {block.children.map((child, i) => (
            <BlockView key={i} block={child} ctx={ctx} />
          ))}
        </blockquote>
      );
    case "list":
      return <ListView list={block} ctx={ctx} />;
  }
}

function ListView({ list, ctx, depth = 0 }: { list: ListBlock; ctx: RenderContext; depth?: number }) {
  const items = list.items.map((item, i) => (
    // 番号は書いた値を出す（`value`）。3. から書き始めたリストを 1. に振り直さない
    <li key={i} value={item.number ?? undefined} className="pl-1">
      <span className="whitespace-pre-wrap">
        <Inlines nodes={item.children} ctx={ctx} />
      </span>
      {item.sublists.map((sublist, j) => (
        <ListView key={j} list={sublist} ctx={ctx} depth={depth + 1} />
      ))}
    </li>
  ));
  return list.ordered ? (
    <ol className="list-decimal pl-6">{items}</ol>
  ) : (
    <ul className={`${BULLETS[Math.min(depth, BULLETS.length - 1)]} pl-6`}>{items}</ul>
  );
}

function Inlines({ nodes, ctx }: { nodes: Inline[]; ctx: RenderContext }) {
  return nodes.map((node, i) => <InlineView key={i} node={node} ctx={ctx} />);
}

function InlineView({ node, ctx }: { node: Inline; ctx: RenderContext }) {
  switch (node.type) {
    case "text":
      if (ctx.highlight && ctx.highlight.length > 0) {
        return <HighlightedText text={node.text} terms={ctx.highlight} />;
      }
      return <Fragment>{node.text}</Fragment>;
    case "bold":
      return (
        <strong className="font-bold">
          <Inlines nodes={node.children} ctx={ctx} />
        </strong>
      );
    case "italic":
      return (
        <em className="italic">
          <Inlines nodes={node.children} ctx={ctx} />
        </em>
      );
    case "underline":
      return (
        <u className="underline">
          <Inlines nodes={node.children} ctx={ctx} />
        </u>
      );
    case "strike":
      return (
        <s className="line-through">
          <Inlines nodes={node.children} ctx={ctx} />
        </s>
      );
    case "code":
      return (
        <code className="rounded-sm border border-border bg-surface-muted px-1 font-mono text-base text-code-text">{node.text}</code>
      );
    case "link": {
      // 文字付きのリンク（ADR 0051 決定 4 の追記）は文字を出し、行き先の URL をホバーで見せる。
      // 文字と行き先が違うリンクは、行き先を隠したなりすましに使えるため
      const text = node.label ?? node.url;
      const title = node.label === undefined ? undefined : node.url;
      if (!ctx.interactive)
        return (
          <span title={title} className="text-primary">
            {text}
          </span>
        );
      // パーマリンクはアプリの中を移るので、同じタブで飛ぶ（ADR 0051 決定 4。飛ぶ仕組みは ADR 0042）
      const permalink = ctx.origin === undefined ? null : parsePermalink(node.url, ctx.origin);
      if (permalink)
        return (
          <Link href={permalinkPath(permalink)} title={title} className="text-primary hover:underline">
            {text}
          </Link>
        );
      return (
        // 別のタブで開く（オーナーの要望。ADR 0051 決定 4）。開いた先から window.opener を触らせない
        <a href={node.url} title={title} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {text}
        </a>
      );
    }
    case "mention":
      if (node.kind === "user") {
        const name = ctx.names[node.id];
        // 引けない ID はチップにしない。誰か分からないまま `@` を出すより、書かれたままの方が読める
        if (name === undefined) return <Fragment>{node.raw}</Fragment>;
        if (!ctx.interactive) return <span className={MENTION_CHIP}>@{name}</span>;
        return (
          <button type="button" onClick={() => ctx.onOpenProfile?.(node.id)} className={`${MENTION_CHIP} hover:underline`}>
            @{name}
          </button>
        );
      }
      return <span className={MENTION_CHIP}>@{node.kind}</span>;
    case "channel":
      return <ChannelChip id={node.id} ctx={ctx} />;
  }
}

/**
 * チャンネルへのリンク（ADR 0062 決定 3）。public は `#名前`、private は `#` の代わりに鍵のアイコン（サイドバーと同じ）。
 * 引けないもの（参加していない private、削除済み）は押せない文字にする。ID を出しても誰にも読めないため。
 */
function ChannelChip({ id, ctx }: { id: string; ctx: RenderContext }) {
  const channel = ctx.channelLinks.channels[id];
  if (!channel) return <span className="text-text-muted">#{UNRESOLVED_CHANNEL_NAME}</span>;
  const label = channel.private ? (
    <>
      <LockIcon aria-label="非公開" aria-hidden={false} role="img" className="mr-0.5 inline size-3.5 align-middle" />
      {channel.name}
    </>
  ) : (
    `#${channel.name}`
  );
  if (!ctx.interactive) return <span className={MENTION_CHIP}>{label}</span>;
  return (
    <Link href={ctx.channelLinks.href(id)} className={`${MENTION_CHIP} hover:underline`}>
      {label}
    </Link>
  );
}
