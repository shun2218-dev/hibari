import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/choice";
import { Dialog } from "@/components/ui/dialog";
import { HashIcon, HeadphonesIcon, LockIcon, SearchIcon } from "@/components/ui/icons";

import type { HuddlePlaceView } from "@/components/chat/types";
import type { DmCandidateView } from "./start-dm";

/** 新規ハドルミーティングの候補。人を選べばその人との DM、チャンネルを選べばそのチャンネルで始める。 */
export type NewHuddleCandidate =
  | { kind: "user"; id: string; user: DmCandidateView }
  | { kind: "room"; id: string; room: HuddlePlaceView };

/** 選んだ候補の値（`user:ID` か `room:ID`。人とルームの ID が重ならないように種類を付ける）。 */
export function newHuddleValue(candidate: Pick<NewHuddleCandidate, "kind" | "id">) {
  return `${candidate.kind}:${candidate.id}`;
}

/**
 * 「＋ 新規ハドルミーティング」のダイアログ（ADR 0067 決定 8）。形は Slack の実物に合わせる:
 * 見出し「ハドルミーティングにメンバーを招待する」、名前かチャンネル名の検索、「キャンセル」「ハドルミーティングを開始する」。
 *
 * グループ DM はスコープの外なので、選べるのは 1 人か 1 つのチャンネルだけ。
 * 候補のチャンネルは、自分が投稿できる（ハドルに入れる）ものだけにする（呼ぶ側が絞る）。
 * 「開始する」を押すと、選んだ場所の参加前のプレビューを出す（いきなり入らない）。
 */
export function NewHuddleDialog({
  open,
  search = "",
  onSearchChange,
  candidates,
  selected,
  onSelect,
  onCancel,
  onStart,
  starting = false,
}: {
  open: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
  /** 打った文字に合う候補。まだ何も打っていなければ、よく使う人とチャンネルを出す（並べるのは呼ぶ側）。 */
  candidates: NewHuddleCandidate[];
  /** 選んでいる候補の値（`newHuddleValue`）。 */
  selected?: string;
  onSelect?: (value: string) => void;
  onCancel?: () => void;
  onStart?: () => void;
  /** DM を作っている間（二重に押させない）。 */
  starting?: boolean;
}) {
  const users = candidates.filter((c) => c.kind === "user");
  const rooms = candidates.filter((c) => c.kind === "room");
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="wide"
      title="ハドルミーティングにメンバーを招待する"
      description="名前を選ぶと DM で、チャンネルを選ぶとそのチャンネルでハドルミーティングを始めます。"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onStart} disabled={starting || selected === undefined} className="gap-1.5">
            <HeadphonesIcon className="size-4" />
            ハドルミーティングを開始する
          </Button>
        </>
      }
    >
      <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
        <SearchIcon className="size-4 shrink-0 text-text-secondary" />
        <input
          type="search"
          aria-label="名前かチャンネル名で検索する"
          placeholder="名前かチャンネル名で検索する"
          value={search}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base text-text focus-visible:outline-none"
        />
      </label>
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">一致する人やチャンネルがありません</p>
      ) : (
        <fieldset className="-mx-1 flex max-h-80 flex-col gap-2 overflow-y-auto px-1">
          <legend className="sr-only">ハドルミーティングを始める場所</legend>
          {users.length > 0 && <GroupLabel>メンバー（DM）</GroupLabel>}
          {users.map((c) => (
            <RadioCard
              key={newHuddleValue(c)}
              name="new-huddle"
              value={newHuddleValue(c)}
              checked={selected === newHuddleValue(c)}
              onChange={onSelect}
              leading={<Avatar id={c.user.id} name={c.user.name} imageUrl={c.user.avatarUrl} size="sm" presence={c.user.presence} />}
              title={c.user.name}
              description={<span className="font-mono">@{c.user.handle}</span>}
            />
          ))}
          {rooms.length > 0 && <GroupLabel>チャンネル</GroupLabel>}
          {rooms.map((c) => (
            <RadioCard
              key={newHuddleValue(c)}
              name="new-huddle"
              value={newHuddleValue(c)}
              checked={selected === newHuddleValue(c)}
              onChange={onSelect}
              leading={
                <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-muted text-text-secondary">
                  {c.room.kind === "private" ? <LockIcon className="size-3.5" /> : <HashIcon className="size-4" />}
                </span>
              }
              title={c.room.name}
            />
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <p className="px-1 pt-1 text-2xs font-medium text-text-secondary">{children}</p>;
}
