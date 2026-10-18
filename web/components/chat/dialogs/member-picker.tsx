import { Avatar } from "@/components/ui/avatar";
import { RadioCard } from "@/components/ui/choice";
import { SearchIcon } from "@/components/ui/icons";

import type { DmCandidateView } from "./start-dm";

/**
 * ダイアログの中の、メンバーを選ぶ一覧（DM の相手・チャンネルに足す人）。
 */
/** 相手をひとり選ぶ（DM とメンバーの追加で同じ形にする）。 */
export function MemberPicker({
  name,
  candidates,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  emptyText,
}: {
  name: string;
  candidates: DmCandidateView[];
  selectedId?: string;
  search: string;
  onSearchChange?: (value: string) => void;
  onSelect?: (userId: string) => void;
  emptyText: string;
}) {
  return (
    <>
      <label className="flex h-8.5 items-center gap-2 rounded-sm border border-border px-2.5 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary">
        <SearchIcon className="size-4 shrink-0 text-text-secondary" />
        <input
          type="search"
          aria-label="メンバーを検索"
          placeholder="メンバーを検索"
          value={search}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-text focus-visible:outline-none"
        />
      </label>
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">{emptyText}</p>
      ) : (
        <fieldset className="-mx-1 flex max-h-66 flex-col gap-2 overflow-y-auto px-1">
          <legend className="sr-only">相手</legend>
          {candidates.map((candidate) => (
            <RadioCard
              key={candidate.id}
              name={name}
              value={candidate.id}
              checked={candidate.id === selectedId}
              onChange={onSelect}
              leading={
                <Avatar
                  id={candidate.id}
                  name={candidate.name}
                  imageUrl={candidate.avatarUrl}
                  size="sm"
                  presence={candidate.presence}
                />
              }
              title={candidate.name}
              description={<span className="font-mono">@{candidate.handle}</span>}
            />
          ))}
        </fieldset>
      )}
    </>
  );
}
