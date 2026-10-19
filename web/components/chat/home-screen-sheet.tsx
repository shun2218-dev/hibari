"use client";

import { type ReactNode, useId } from "react";

import { Button } from "@/components/ui/button";
import { AddToHomeScreenIcon, ShareIcon } from "@/components/ui/icons";
import { Portal } from "@/components/ui/portal";

/**
 * iPhone / iPad の「ホーム画面に追加する」の手順（ADR 0069 決定 1。iOS はホーム画面に追加した hibari だけがプッシュを受け取れる）。
 *
 * サイドバーの帯の「追加のしかた」と、設定の「追加のしかたを見る」から開く。
 * ホーム画面への追加はページから起こせない（Safari にその API がない）ので、押す場所を Safari の見た目のまま示すしかない。
 * 開くのは iPhone / iPad の Safari だけなので、下から出るシートにする（メンバーやリアクションのシートと同じ形）。
 * 開くかどうかは呼ぶ側が決め、開いている間だけ描く。
 */
export function HomeScreenSheet({ onClose }: { onClose?: () => void }) {
  const titleId = useId();
  return (
    <Portal>
      <div aria-hidden className="fixed inset-0 z-40 bg-overlay" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-5 rounded-t-lg bg-surface px-5 pt-6 pb-8"
      >
        <div className="flex flex-col gap-2">
          <h2 id={titleId} className="text-xl font-bold text-text">
            ホーム画面に追加する
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            iPhone では、ホーム画面から開いた hibari だけが通知を受け取れます。追加したら、ホーム画面の hibari を開いて通知を有効にしてください
          </p>
        </div>
        <ol className="flex flex-col gap-3">
          <Step number={1}>
            画面の下の
            <Target icon={<ShareIcon className="size-4" />}>共有</Target>
            を押す
          </Step>
          <Step number={2}>
            <Target icon={<AddToHomeScreenIcon className="size-4" />}>ホーム画面に追加</Target>
            を選ぶ
          </Step>
          <Step number={3}>ホーム画面の hibari を開き、設定の「通知」でプッシュ通知を有効にする</Step>
        </ol>
        <Button variant="secondary" onClick={onClose} className="w-full">
          閉じる
        </Button>
      </div>
    </Portal>
  );
}

function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      {/* 番号の丸はキャンバスのとおり緑の淡い地（Badge の primary と同じ組）。琥珀は「いま起きていること」なので使わない */}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-bold text-primary">
        {number}
      </span>
      <span className="pt-0.5 text-base leading-relaxed text-text">{children}</span>
    </li>
  );
}

/** Safari の中で押すものを、アイコンと名前の組で示す（Safari のボタンの見た目を探しやすくするため）。 */
function Target({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="mx-1 inline-flex items-center gap-1 rounded-sm bg-surface-muted px-1.5 align-middle font-semibold">
      {icon}
      {children}
    </span>
  );
}
