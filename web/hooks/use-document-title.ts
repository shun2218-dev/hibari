"use client";

import { useEffect } from "react";

/**
 * 名前が要るタブのタイトルを `document.title` に入れる（ADR 0063 決定 2）。組み立ては lib/document-title.ts。
 *
 * ワークスペース名やルーム名はブラウザが API から取るので、ページの `metadata` には書けない。
 * `undefined` の間（名前をまだ読んでいない）は触らず、`metadata` のタイトルのままにする。
 *
 * Next.js は `metadata` の `<title>` を、ページを移るたびや遅れて（streaming）head に入れ直しうる。
 * 入れ直されると、こちらで入れたタイトルが `metadata` の値に戻ってしまうので、head を見張って入れ直し返す。
 * 画面を離れたら元のタイトルに戻す（戻さないと、次の画面が同じ `metadata` を継いでいるとき古い名前が残る）。
 */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    if (title === undefined) return;
    const previous = document.title;
    document.title = title;
    // 入れ直し返したときの変化でもう一度呼ばれるが、そのときは同じ値なので何もしない
    const observer = new MutationObserver(() => {
      if (document.title !== title) document.title = title;
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = previous;
    };
  }, [title]);
}
