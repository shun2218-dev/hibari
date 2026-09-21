import { Fragment, type ReactNode } from "react";

import { type Block, type Inline, type ListBlock, parseBody } from "@/lib/chat/body-format";

/**
 * メッセージの本文（ADR 0051）。`parseBody` の木を React の要素に写すだけで、HTML の文字列は作らない。
 * 本文の文字はすべて React のテキストとして出るので、`<script>` と書いても文字のまま見える（決定 3）。
 *
 * 色は `docs/ui/tokens.md` の決まりどおり。リンクと個人のチップは押せるものなので緑にする。
 * `@channel` / `@here` はルームの全員に飛ぶので、個人より目立たせる（ADR 0043。オーナーの判断、2026-09-19）。
 * 押せないので琥珀を当てられる。自分宛ての行の背景も琥珀なので、そこに埋もれないように地の琥珀で塗る。
 *
 * 段落は改行をそのまま出す（`whitespace-pre-wrap`）。書式のない本文は段落 1 つになるので、いままでと同じ見た目になる。
 */
export function MessageBody({
  body,
  mentionNames,
  onOpenProfile,
  trailing,
  className,
}: {
  body: string;
  mentionNames?: Readonly<Record<string, string>>;
  /** 個人のチップを押した（Phase 6.9）。渡さなければ押せない見た目のままにする。 */
  onOpenProfile?: (userId: string) => void;
  /** 本文の最後の行に続けて出すもの（「（編集済み）」）。最後が段落でなければ、本文の下に出す。 */
  trailing?: ReactNode;
  className?: string;
}) {
  const ctx: RenderContext = { names: mentionNames ?? {}, onOpenProfile };
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
};

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

function ListView({ list, ctx }: { list: ListBlock; ctx: RenderContext }) {
  const items = list.items.map((item, i) => (
    // 番号は書いた値を出す（`value`）。3. から書き始めたリストを 1. に振り直さない
    <li key={i} value={item.number ?? undefined} className="pl-1">
      <span className="whitespace-pre-wrap">
        <Inlines nodes={item.children} ctx={ctx} />
      </span>
      {item.sublists.map((sublist, j) => (
        <ListView key={j} list={sublist} ctx={ctx} />
      ))}
    </li>
  ));
  return list.ordered ? (
    <ol className="list-decimal pl-6">{items}</ol>
  ) : (
    <ul className="list-disc pl-6">{items}</ul>
  );
}

function Inlines({ nodes, ctx }: { nodes: Inline[]; ctx: RenderContext }) {
  return nodes.map((node, i) => <InlineView key={i} node={node} ctx={ctx} />);
}

function InlineView({ node, ctx }: { node: Inline; ctx: RenderContext }) {
  switch (node.type) {
    case "text":
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
    case "strike":
      return (
        <s className="line-through">
          <Inlines nodes={node.children} ctx={ctx} />
        </s>
      );
    case "code":
      return (
        <code className="rounded-sm border border-border bg-surface-muted px-1 font-mono text-base text-text">{node.text}</code>
      );
    case "link":
      return (
        // 別のタブで開く（オーナーの要望。ADR 0051 決定 4）。開いた先から window.opener を触らせない
        <a href={node.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {node.url}
        </a>
      );
    case "mention":
      if (node.kind === "user") {
        const name = ctx.names[node.id];
        // 引けない ID はチップにしない。誰か分からないまま `@` を出すより、書かれたままの方が読める
        if (name === undefined) return <Fragment>{node.raw}</Fragment>;
        return (
          <button
            type="button"
            onClick={() => ctx.onOpenProfile?.(node.id)}
            className="rounded-sm bg-primary-subtle px-1 font-semibold text-primary hover:underline"
          >
            @{name}
          </button>
        );
      }
      return <span className="rounded-sm bg-attention px-1 font-semibold text-on-attention">@{node.kind}</span>;
  }
}
