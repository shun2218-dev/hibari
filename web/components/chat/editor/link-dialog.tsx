"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";

/**
 * 文字付きのリンクを入れる画面（ADR 0052 決定 5 / ADR 0051 決定 4 の追記）。
 *
 * 文字は `<` `>` `` ` `` と改行を使えない（使うと本文で文字付きのリンクにならない）。URL は http / https だけ。
 * どちらも満たさないうちは「保存」を押せない。理由はその欄の補足に出す。
 */
export function LinkDialog({
  open,
  initialText = "",
  initialUrl = "",
  onCancel,
  onSave,
}: {
  open: boolean;
  /** 選んでいた文字。何も選ばずに開いたら空。 */
  initialText?: string;
  /** 選んでいたのがリンクなら、その URL。 */
  initialUrl?: string;
  onCancel?: () => void;
  onSave?: (link: { text: string; url: string }) => void;
}) {
  // 開くたびに初期値から始めたいので、呼ぶ側は開くたびに key を変えて作り直す
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const textError = /[<>`\n]/u.test(text) ? "< > ` は使えません" : undefined;
  const urlError = url !== "" && !isHttpUrl(url) ? "http:// か https:// で始まる URL を入れてください" : undefined;
  const canSave = url !== "" && !textError && !urlError;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="リンクを追加"
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={() => onSave?.({ text: text.trim() === "" ? url : text, url })} disabled={!canSave}>
            保存
          </Button>
        </>
      }
    >
      <TextField
        label="テキスト"
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint={textError ?? "空のままなら URL をそのまま出します。"}
      />
      <TextField
        label="リンク"
        value={url}
        autoFocus
        onChange={(e) => setUrl(e.target.value.trim())}
        placeholder="https://"
        mono
        hint={urlError}
      />
    </Dialog>
  );
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s<>`|]+$/u.test(url);
}
