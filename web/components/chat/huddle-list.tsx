import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CloseIcon,
  DmIcon,
  HashIcon,
  HeadphonesIcon,
  LinkIcon,
  LockIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { MenuItem } from "@/components/ui/menu-item";
import { Popover } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/lib/cx";

import type {
  HuddleListItemView,
  HuddleListScope,
  HuddleOngoingCardView,
  HuddlePlaceView,
  HuddleSuggestionView,
  UserRef,
} from "./types";

/** 絞り込みの候補の場所（ルーム ID と見え方）。 */
export type HuddlePlaceOption = { id: string; room: HuddlePlaceView };

/** 開いている絞り込み（1 つ目の範囲・相手・場所）。 */
export type HuddleListFilterKey = "scope" | "person" | "place";

type HuddleListProps = {
  /** いま進行中の、自分が入れるハドル（ストアの生きた状態から作る）。 */
  ongoing: HuddleOngoingCardView[];
  suggestions: HuddleSuggestionView[];
  scope: HuddleListScope;
  /** 「相手」で選んだ人。 */
  person?: UserRef;
  /** 「場所」で選んだルーム。 */
  place?: HuddlePlaceOption;
  /** 最近のハドルミーティング。取得中は undefined。 */
  items?: HuddleListItemView[];
  /** 続きを取っている（いちばん下にくるくるを出す）。 */
  loadingMore?: boolean;
  onReachEnd?: () => void;
  onNew?: () => void;
  /** 進行中のカードの「参加する」（プレビューを通す）と「参加中」（ハドルの画面を前に出す）。 */
  onJoin?: (key: string) => void;
  onShowScreen?: (key: string) => void;
  /** 提案のカードの「開始する」（プレビューを通す）。 */
  onStart?: (key: string) => void;
  openFilter?: HuddleListFilterKey;
  onToggleFilter?: (filter: HuddleListFilterKey) => void;
  onChangeScope?: (scope: HuddleListScope) => void;
  /** 相手と場所の絞り込みの、検索欄に打った文字と候補。 */
  filterQuery?: string;
  onFilterQueryChange?: (value: string) => void;
  personOptions?: UserRef[];
  placeOptions?: HuddlePlaceOption[];
  onSelectPerson?: (userId: string | undefined) => void;
  onSelectPlace?: (roomId: string | undefined) => void;
  /** 「…」を開いている行と、「参加者を表示する」で参加者を出している行（どちらも 1 度に 1 件）。 */
  openMenuKey?: string;
  onToggleMenu?: (key: string) => void;
  participantsKey?: string;
  onShowParticipants?: (key: string | undefined) => void;
  onOpenProfile?: (userId: string) => void;
  onToggleSave?: (key: string) => void;
  onCopyLink?: (key: string) => void;
  /** 直前にリンクをコピーした行（メニューの文言を「コピーしました」に変える。ADR 0040 と同じ）。 */
  copiedKey?: string;
  /** ポインタを乗せている行（story で見せるため）。 */
  hoveredKey?: string;
  /** モバイルで一覧に戻る。md 以上では出さない。 */
  onBack?: () => void;
};

/**
 * ハドルの一覧（ADR 0067 決定 6）。サイドバーの「ハドルミーティング」から開き、ルームの代わりにメインの領域に出す（スレッドの一覧と同じ）。
 *
 * Slack の実物と同じ並び: 見出しと「＋ 新規ハドルミーティング」、進行中のハドルと提案のカード、「最近のハドルミーティング」と 3 つの絞り込み。
 * 進行中のハドルは上のカードにだけ出し、終わってから「最近」に入る（終わっていないのに「最近」に出るのは矛盾する。オーナーの確認）。
 */
export function HuddleList(props: HuddleListProps) {
  const { ongoing, suggestions, items, onNew, onBack } = props;
  const nothingYet =
    ongoing.length === 0 &&
    suggestions.length === 0 &&
    items?.length === 0 &&
    props.scope === "all" &&
    !props.person &&
    !props.place;
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 md:pr-4 md:pl-4">
        <IconButton label="チャンネル一覧に戻る" onClick={onBack} className="md:hidden">
          <ChevronLeftIcon className="size-5" />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate pl-1 text-lg font-bold text-text md:pl-0">ハドルミーティング</h1>
        <Button variant="secondary" size="sm" onClick={onNew} aria-label="新規ハドルミーティング" className="gap-1.5 max-md:w-8 max-md:px-0">
          <PlusIcon className="size-4 shrink-0" />
          <span className="hidden md:inline">新規ハドルミーティング</span>
        </Button>
      </header>

      {nothingYet ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <HeadphonesIcon className="size-6 text-text-muted" />
          <p className="text-lg font-medium text-text">まだハドルミーティングはありません</p>
          <p className="max-w-96 text-sm leading-relaxed text-text-muted">
            チャンネルや DM のヘッダーのヘッドフォンから始めると、ここに表示されます
          </p>
          <Button variant="secondary" onClick={onNew} className="mt-3 gap-1.5">
            <PlusIcon className="size-4" />
            新規ハドルミーティング
          </Button>
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) props.onReachEnd?.();
          }}
        >
          <div className="flex w-full flex-col gap-8 px-4 py-6 md:px-10">
            {(ongoing.length > 0 || suggestions.length > 0) && (
              <ul aria-label="進行中のハドルミーティングとおすすめ" className="flex flex-wrap gap-4">
                {/* 幅の段は md しかないので（トークンの決まり）、列の数ではなくカードの幅を決めて折り返す */}
                {ongoing.map((card) => (
                  <li key={card.key} className="w-full md:w-64">
                    <OngoingCard card={card} onJoin={() => props.onJoin?.(card.key)} onShowScreen={() => props.onShowScreen?.(card.key)} />
                  </li>
                ))}
                {suggestions.map((s) => (
                  <li key={s.key} className="w-full md:w-64">
                    <SuggestionCard suggestion={s} onStart={() => props.onStart?.(s.key)} />
                  </li>
                ))}
              </ul>
            )}
            <RecentSection {...props} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * 進行中のハドルのカード。Slack の上半分はハドルのテーマの画像だが、hibari にテーマはないので、
 * 「いま起きていること」の琥珀の地に入っている人の顔を並べる（ADR 0067 決定 6）。経過時間も琥珀。
 */
function OngoingCard({ card, onJoin, onShowScreen }: { card: HuddleOngoingCardView; onJoin: () => void; onShowScreen: () => void }) {
  return (
    <article aria-label={`${card.room.name} のハドルミーティング（進行中）`} className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="relative flex h-28 items-center justify-center bg-attention-subtle">
        <span className="absolute top-2.5 left-2.5 rounded-full bg-attention px-2 py-0.5 text-2xs font-semibold text-on-attention">
          {card.elapsedLabel}
        </span>
        <Faces users={card.participants} max={4} size="lg" ring="ring-attention-subtle" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="min-w-0">
          <PlaceName room={card.room} className="text-base font-bold" />
          <p className="text-xs text-text-muted">{card.participants.length} 人</p>
        </div>
        {card.joined ? (
          <Button variant="secondary" size="sm" onClick={onShowScreen} className="mt-auto w-full gap-1.5">
            <HeadphonesIcon className="size-4" />
            参加中
          </Button>
        ) : (
          <Button size="sm" onClick={onJoin} className="mt-auto w-full gap-1.5">
            <HeadphonesIcon className="size-4" />
            参加する
          </Button>
        )}
      </div>
    </article>
  );
}

/** 提案のカード（ADR 0067 決定 7）。まだ始まっていないので、点線の枠にして進行中のカードと見分ける。 */
function SuggestionCard({ suggestion, onStart }: { suggestion: HuddleSuggestionView; onStart: () => void }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-dashed border-border bg-surface">
      <div className="flex h-28 items-center justify-center bg-surface-muted">
        <Faces users={suggestion.participants} max={4} size="lg" ring="ring-surface-muted" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="min-w-0">
          {/* 文として読ませるので、場所の名前も文の中に流す（折り返しで名前だけが 1 行に残らないように） */}
          <p className="text-sm leading-relaxed text-text">
            <strong className="font-bold">
              {suggestion.room.kind === "public" && "#"}
              {suggestion.room.kind === "private" && (
                <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="mr-0.5 inline size-3.5 align-baseline" />
              )}
              {suggestion.room.name}
            </strong>{" "}
            でハドルミーティングを開始しますか？
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
            過去 1 週間にここで {suggestion.count} 回ハドルミーティングを実施しました
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onStart} className="mt-auto w-full gap-1.5">
          <HeadphonesIcon className="size-4" />
          ハドルミーティングを開始する
        </Button>
      </div>
    </article>
  );
}

const scopeLabel: Record<HuddleListScope, string> = {
  all: "すべてのハドルミーティング",
  missed: "参加しなかったハドルミーティング",
};

function RecentSection(props: HuddleListProps) {
  const { items, scope, person, place, openFilter, onToggleFilter } = props;
  const filtered = scope !== "all" || person !== undefined || place !== undefined;
  return (
    <section aria-labelledby="recent-huddles" className="flex flex-col gap-4">
      <h2 id="recent-huddles" className="text-lg font-bold text-text">
        最近のハドルミーティング
      </h2>
      <div className="flex flex-wrap gap-2">
        <FilterButton
          label={scopeLabel[scope]}
          active={scope !== "all"}
          open={openFilter === "scope"}
          onClick={() => onToggleFilter?.("scope")}
        >
          <Popover label="範囲" className="top-10 left-0 w-72" onDismiss={() => onToggleFilter?.("scope")}>
            <ul>
              {(["all", "missed"] as const).map((value) => (
                <li key={value}>
                  <OptionButton selected={value === scope} onClick={() => props.onChangeScope?.(value)}>
                    {scopeLabel[value]}
                  </OptionButton>
                </li>
              ))}
            </ul>
          </Popover>
        </FilterButton>
        <FilterButton
          label={person ? `相手: ${person.name}` : "相手"}
          active={person !== undefined}
          open={openFilter === "person"}
          onClick={() => onToggleFilter?.("person")}
        >
          <FilterPicker
            label="相手"
            placeholder="名前で検索する"
            query={props.filterQuery ?? ""}
            onQueryChange={props.onFilterQueryChange}
            onDismiss={() => onToggleFilter?.("person")}
            onClear={person ? () => props.onSelectPerson?.(undefined) : undefined}
            options={(props.personOptions ?? []).map((u) => ({
              id: u.id,
              selected: u.id === person?.id,
              leading: <Avatar id={u.id} name={u.name} imageUrl={u.avatarUrl} size="xs" />,
              label: u.name,
            }))}
            onSelect={(id) => props.onSelectPerson?.(id)}
          />
        </FilterButton>
        <FilterButton
          label={place ? `場所: ${place.room.kind === "dm" ? "" : "#"}${place.room.name}` : "場所"}
          active={place !== undefined}
          open={openFilter === "place"}
          onClick={() => onToggleFilter?.("place")}
        >
          <FilterPicker
            label="場所"
            placeholder="チャンネル名や名前で検索する"
            query={props.filterQuery ?? ""}
            onQueryChange={props.onFilterQueryChange}
            onDismiss={() => onToggleFilter?.("place")}
            onClear={place ? () => props.onSelectPlace?.(undefined) : undefined}
            options={(props.placeOptions ?? []).map((o) => ({
              id: o.id,
              selected: o.id === place?.id,
              leading: <PlaceIcon kind={o.room.kind} />,
              label: o.room.name,
            }))}
            onSelect={(id) => props.onSelectPlace?.(id)}
          />
        </FilterButton>
      </div>

      {items === undefined ? (
        <div className="flex justify-center py-10">
          <Spinner className="size-5 text-text-muted" />
          <span className="sr-only">読み込み中</span>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-text-muted">
          {filtered
            ? scope === "missed" && !person && !place
              ? "参加しなかったハドルミーティングはありません"
              : "条件に合うハドルミーティングはありません"
            : "終わったハドルミーティングはまだありません"}
        </p>
      ) : (
        <ul aria-label="最近のハドルミーティング" className="rounded-lg border border-border">
          {items.map((item, i) => (
            <li key={item.key} className="border-b border-border last:border-b-0">
              <RecentRow
                item={item}
                // 行の地が枠の角からはみ出さないように、端の行だけ角を丸める（メニューが切れるので枠に overflow-hidden は付けない）
                edge={cx(i === 0 && "rounded-t-lg", i === items.length - 1 && !props.loadingMore && "rounded-b-lg")}
                {...props}
              />
            </li>
          ))}
          {props.loadingMore && (
            <li className="flex justify-center py-4">
              <Spinner className="size-5 text-text-muted" />
              <span className="sr-only">続きを読み込み中</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function RecentRow({ item, edge, ...props }: HuddleListProps & { item: HuddleListItemView; edge?: string }) {
  const menuOpen = props.openMenuKey === item.key;
  const participantsOpen = props.participantsKey === item.key;
  const forceHover = props.hoveredKey === item.key || menuOpen || participantsOpen;
  return (
    <div className={cx("group relative flex items-center gap-3 px-3 py-3 md:px-4", edge, forceHover ? "bg-surface-muted" : "hover:bg-surface-muted")}>
      {/* 行全体を押せるように、リンクを行の上に広げる（スレッドの一覧と同じ）。行き先は会話のハドルのメッセージ */}
      <Link href={item.href} aria-label={`${item.room.name} のハドルミーティングへ移動`} className="absolute inset-0" />
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-muted text-text-secondary group-hover:bg-surface">
        <HeadphonesIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <PlaceName room={item.room} className="text-base font-bold" />
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-text-muted">
          <span>{item.timeLabel}</span>
          <span aria-hidden>·</span>
          <span>{item.durationLabel}</span>
          {item.replyCount > 0 && (
            <>
              <span aria-hidden>·</span>
              {/* 行のリンクの上に重ねて、返信だけはハドルのチャット（スレッド）を開く */}
              <Link href={item.threadHref} className="relative font-semibold text-primary hover:underline">
                {item.replyCount} 件の返信
              </Link>
            </>
          )}
        </p>
      </div>
      <Faces users={item.participants} max={3} size="sm" ring={forceHover ? "ring-surface-muted" : "ring-surface group-hover:ring-surface-muted"} />
      <div className="relative">
        <IconButton label="その他の操作" aria-expanded={menuOpen} onClick={() => props.onToggleMenu?.(item.key)} className={cx("relative", menuOpen && "bg-surface")}>
          <MoreIcon className="size-4" />
        </IconButton>
        {menuOpen && (
          <Popover label="ハドルミーティングの操作" className="top-9 right-0 w-80" onDismiss={() => props.onToggleMenu?.(item.key)}>
            <MenuItem icon={UsersIcon} onClick={() => props.onShowParticipants?.(item.key)}>
              <span className="flex flex-1 items-baseline justify-between gap-2">
                参加者を表示する
                <span className="text-xs text-text-muted">{item.participants.length} 人のメンバー</span>
              </span>
            </MenuItem>
            <MenuItem icon={BookmarkIcon} onClick={() => props.onToggleSave?.(item.key)}>
              {item.saved ? "「後で」から外す" : "「後で」に保存"}
            </MenuItem>
            <MenuItem icon={LinkIcon} onClick={() => props.onCopyLink?.(item.key)}>
              {props.copiedKey === item.key ? "コピーしました" : "ハドルミーティングのリンクをコピー"}
            </MenuItem>
          </Popover>
        )}
        {participantsOpen && (
          <Popover label="参加者" className="top-9 right-0 w-72" onDismiss={() => props.onShowParticipants?.(undefined)}>
            <p className="px-2.5 pt-1 pb-2 text-xs font-semibold text-text-secondary">参加者（{item.participants.length} 人）</p>
            <ul className="max-h-72 overflow-y-auto">
              {item.participants.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => props.onOpenProfile?.(user.id)}
                    className="flex h-10 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
                  >
                    <Avatar id={user.id} name={user.name} imageUrl={user.avatarUrl} size="xs" />
                    <span className="truncate">{user.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Popover>
        )}
      </div>
    </div>
  );
}

/** 絞り込みのボタン（Slack のプルダウン）。選んでいる絞り込みは緑の地にして、かかっていることを見せる。 */
function FilterButton({
  label,
  active,
  open,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  open: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx(
          "inline-flex h-8 max-w-72 items-center gap-1.5 rounded-sm border px-3 text-sm font-semibold",
          active ? "border-primary bg-primary-subtle text-primary" : "border-border bg-surface text-text hover:bg-surface-muted",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="size-4 shrink-0" />
      </button>
      {open && children}
    </div>
  );
}

/** 相手と場所の絞り込み。検索欄と候補を出し、1 つを選ぶ（検索のフィルターの送信者・場所と同じ考え方。ADR 0061）。 */
function FilterPicker({
  label,
  placeholder,
  query,
  onQueryChange,
  options,
  onSelect,
  onClear,
  onDismiss,
}: {
  label: string;
  placeholder: string;
  query: string;
  onQueryChange?: (value: string) => void;
  options: { id: string; selected: boolean; leading: ReactNode; label: string }[];
  onSelect: (id: string) => void;
  onClear?: () => void;
  onDismiss: () => void;
}) {
  return (
    <Popover label={label} className="top-10 left-0 w-80" onDismiss={onDismiss}>
      <label className="m-1 flex h-8.5 items-center gap-2 rounded-sm border border-border px-2.5 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
        <SearchIcon className="size-4 shrink-0 text-text-secondary" />
        <input
          type="search"
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange?.(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-text focus-visible:outline-none"
        />
      </label>
      {options.length === 0 ? (
        <p className="px-2.5 py-4 text-center text-sm text-text-muted">見つかりません</p>
      ) : (
        <ul className="mt-1 max-h-64 overflow-y-auto">
          {options.map((o) => (
            <li key={o.id}>
              <OptionButton selected={o.selected} onClick={() => onSelect(o.id)} leading={o.leading}>
                {o.label}
              </OptionButton>
            </li>
          ))}
        </ul>
      )}
      {onClear && (
        <div className="mt-1 border-t border-border pt-1">
          <MenuItem icon={CloseIcon} onClick={onClear}>
            絞り込みを外す
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

/** 絞り込みの選択肢。選んでいるものは右に印を付け、読み上げでも押されていると分かるようにする。 */
function OptionButton({
  selected,
  onClick,
  leading,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  leading?: ReactNode;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex h-9.5 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-base text-text hover:bg-surface-muted"
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <CheckIcon className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

/** 重ねた顔。多ければ「+N」を添える。 */
function Faces({ users, max, size, ring }: { users: UserRef[]; max: number; size: "sm" | "lg"; ring: string }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span aria-hidden className="flex shrink-0 items-center -space-x-2">
      {shown.map((u) => (
        <Avatar key={u.id} id={u.id} name={u.name} imageUrl={u.avatarUrl} size={size} className={cx("rounded-full ring-2", ring)} />
      ))}
      {rest > 0 && (
        <span
          className={cx(
            "flex items-center justify-center rounded-full bg-surface-muted font-semibold text-text-secondary ring-2",
            size === "lg" ? "size-10 text-xs" : "size-8 text-2xs",
            ring,
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

function PlaceIcon({ kind }: { kind: HuddlePlaceView["kind"] }) {
  if (kind === "public") return <HashIcon aria-label="公開チャンネル" aria-hidden={false} role="img" className="size-4 shrink-0 text-text-secondary" />;
  if (kind === "private") return <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-4 shrink-0 text-text-secondary" />;
  return <DmIcon aria-label="ダイレクトメッセージ" aria-hidden={false} role="img" className="size-4 shrink-0 text-text-secondary" />;
}

/** 場所の名前。チャンネルは「#名前」（非公開は鍵）、DM は相手の表示名だけ。 */
function PlaceName({ room, className }: { room: HuddlePlaceView; className?: string }) {
  return (
    <span className={cx("flex min-w-0 items-center gap-0.5 text-text", className)}>
      {room.kind === "public" && <HashIcon aria-label="公開チャンネル" aria-hidden={false} role="img" className="size-4 shrink-0" />}
      {room.kind === "private" && <LockIcon aria-label="非公開チャンネル" aria-hidden={false} role="img" className="size-3.5 shrink-0" />}
      <span className="truncate">{room.name}</span>
    </span>
  );
}
