"use client";

import type { ReactNode, RefObject } from "react";

import { AnchoredPanel } from "@/components/ui/anchored-panel";
import { Avatar, PresenceDot } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { roleLabel, type WorkspaceRole } from "@/components/workspace/types";
import { presenceLabel } from "@/lib/presence";

import type { ProfileView } from "./types";

// 管理画面のメンバー一覧と同じ色分け（オーナーはワークスペースにひとりだけの特別な状態なので琥珀）
const roleTone: Record<WorkspaceRole, BadgeTone> = { owner: "attention", admin: "primary", member: "neutral" };

type KnownProfile = Exclude<ProfileView, { kind: "unknown" }>;

/**
 * カードとパネルに共通する上の段: アバター・表示名とステータスの絵文字・`@handle`・ロールと presence、ステータスの文言。
 * 表示するものはオーナーと確定したものに、Phase 6.8 のカスタムステータスを足したものだけ。
 * 最終オンライン時刻は出さない（ADR 0049）。
 *
 * - card: ホバーのカード。丸いアバター（56px）の右に名前を並べる
 * - panel: 右のパネル。角丸の正方形の写真を幅いっぱいに大きく出し、名前はその下に置く（Slack と同じ。ADR 0050 決定 6 の追記）
 */
export function ProfileSummary({ profile, layout = "card" }: { profile: KnownProfile; layout?: "card" | "panel" }) {
  const { user } = profile;
  const member = profile.kind === "member" ? profile : undefined;
  const status = member ? user.status : undefined;
  const panel = layout === "panel";

  return (
    <>
      <div className={panel ? "flex flex-col gap-4" : "flex gap-3"}>
        {/* 外された人の presence は出さない（一覧にいないので分からない。決定 5）。
            パネルの大きな写真の隅にはドットを重ねず、ロールの横の文言の前に置く（写真から離れて見えるため） */}
        {panel ? (
          <Avatar id={user.id} name={user.name} imageUrl={user.avatarUrl} size="photo" shape="square" className="w-full max-w-88" />
        ) : (
          // 列の高さに引き伸ばされるとドットがアバターの下にずれるので、上に寄せる
          <Avatar
            id={user.id}
            name={user.name}
            imageUrl={user.avatarUrl}
            size="xl"
            presence={member?.presence}
            className="self-start"
          />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate text-xl font-bold text-text">{user.name}</span>
            {status && (
              <span role="img" aria-hidden className="shrink-0 text-lg leading-none">
                {status.emoji}
              </span>
            )}
          </p>
          <p className="truncate font-mono text-xs text-text-muted">@{user.handle}</p>
          {member ? (
            <p className="flex items-center gap-2">
              <Badge tone={roleTone[member.role]}>{roleLabel[member.role]}</Badge>
              {member.presence !== "offline" && (
                <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                  {panel && <PresenceDot presence={member.presence} />}
                  {presenceLabel[member.presence]}
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-text-muted">このワークスペースのメンバーではありません</p>
          )}
        </div>
      </div>

      {/* 名前の横には絵文字だけを出し、文言と期限はここでそのまま読めるようにする（ADR 0049 決定 10） */}
      {status && (status.text || status.expiresLabel) && (
        <p className="mt-3 flex gap-2 rounded-sm bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          <span role="img" aria-hidden className="leading-relaxed">
            {status.emoji}
          </span>
          <span className="min-w-0 leading-relaxed">
            {status.text && <span className="text-text">{status.text}</span>}
            {status.text && status.expiresLabel && " · "}
            {status.expiresLabel}
          </span>
        </p>
      )}
    </>
  );
}

/**
 * ホバーのカード（ADR 0050 決定 6 の追記）。md 以上で、アバターや名前にポインタを乗せたときだけ出す。
 *
 * 中身は手元のメンバー一覧から出せるもの（要約）と「DM を送る」だけ。email は 1 人分の API が要るので、
 * 押して開く右のパネルにだけ出す（ポインタを動かすたびに API を呼ばない）。
 * 自分のカードと外された人のカードには操作を置かない（押せば右のパネルが開く）。
 */
export function ProfileHoverCard({
  profile,
  dmPending = false,
  onSendDm,
}: {
  profile: KnownProfile;
  /** 「DM を送る」を押して、応答を待っている（二重に押させない。決定 4）。 */
  dmPending?: boolean;
  onSendDm?: () => void;
}) {
  const canDm = profile.kind === "member" && !profile.isSelf;
  return (
    <div className="flex flex-col">
      <div className="p-4">
        <ProfileSummary profile={profile} />
      </div>
      {canDm && (
        <div className="border-t border-border p-3">
          <Button className="w-full" onClick={onSendDm} disabled={dmPending}>
            DM を送る
          </Button>
        </div>
      )}
    </div>
  );
}

type HoverBind = {
  onPointerEnter: (event: { pointerType: string }) => void;
  onPointerLeave: (event: { pointerType: string }) => void;
};

/**
 * ホバーのカードの置き場所。アバターや名前の横に浮かせる（行には重ねない。`placeBeside`）。
 * ホバーはポインタのある md 以上でしか起きないので、モバイルのシートは持たない。
 *
 * `bind` にはきっかけと同じホバーの出し入れ（`useHoverIntent`）を渡す。カードに乗っている間は閉じない。
 */
export function ProfileHoverPopup({
  anchorRef,
  label,
  bind,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** 読み上げの名前（「佐藤 直樹 のプロフィール」）。 */
  label: string;
  bind?: HoverBind;
  children: ReactNode;
}) {
  return (
    <AnchoredPanel
      anchorRef={anchorRef}
      label={label}
      beside
      className="w-80 rounded-md border border-border bg-surface shadow-overlay"
    >
      <div {...bind}>{children}</div>
    </AnchoredPanel>
  );
}
