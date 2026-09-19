import { Fragment } from "react";

import { splitBody } from "@/lib/chat/mentions";

/**
 * メッセージの本文（ADR 0042）。`<@ULID>` / `<!channel>` / `<!here>` をチップにして、残りはそのまま出す。
 *
 * 色は `docs/ui/tokens.md` の決まりどおり、押せるものだけを緑にする。
 * 個人のチップは Phase 6.9 でプロフィールのカードを開くので緑、`@channel` / `@here` は押せないので灰色。
 *
 * Phase 6.10（本文の書式）が入ったら、この分解はそちらの解釈に吸収する。
 */
export function MessageBody({
  body,
  mentionNames,
  onOpenProfile,
  className,
}: {
  body: string;
  mentionNames?: Readonly<Record<string, string>>;
  /** 個人のチップを押した（Phase 6.9）。渡さなければ押せない見た目のままにする。 */
  onOpenProfile?: (userId: string) => void;
  className?: string;
}) {
  const names = new Map(Object.entries(mentionNames ?? {}));
  const segments = splitBody(body, names);
  return (
    <span className={className}>
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          // 断片は本文の位置でしか区別できないので、key は添字にする（並びが変わることはない）
          <Fragment key={i}>{segment.text}</Fragment>
        ) : segment.kind === "user" ? (
          <button
            key={i}
            type="button"
            onClick={() => onOpenProfile?.(segment.id)}
            className="rounded-sm bg-primary-subtle px-1 font-semibold text-primary hover:underline"
          >
            @{segment.name}
          </button>
        ) : (
          <span
            key={i}
            className="rounded-sm bg-surface-muted px-1 font-semibold text-text-secondary"
          >
            @{segment.kind}
          </span>
        ),
      )}
    </span>
  );
}
