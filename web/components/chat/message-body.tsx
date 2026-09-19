import { Fragment } from "react";

import { splitBody } from "@/lib/chat/mentions";

/**
 * メッセージの本文（ADR 0043）。`<@ULID>` / `<!channel>` / `<!here>` をチップにして、残りはそのまま出す。
 *
 * 色は `docs/ui/tokens.md` の決まりどおり。個人のチップは Phase 6.9 でプロフィールのカードを開く、
 * つまりリンクと同じ「押せるもの」なので緑にする。
 *
 * `@channel` / `@here` はルームの全員に飛ぶので、個人より目立たせる（オーナーの判断。2026-09-19。Slack に合わせる）。
 * 押せないので琥珀を当てられる（「琥珀の要素を押せるようにしない」に触れない）。自分宛ての行の背景も琥珀なので、
 * そこに埋もれないように、薄い琥珀ではなく地の琥珀で塗る。
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
          <span key={i} className="rounded-sm bg-attention px-1 font-semibold text-on-attention">
            @{segment.kind}
          </span>
        ),
      )}
    </span>
  );
}
