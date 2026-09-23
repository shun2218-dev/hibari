import type { RoomOption } from "@/components/chat/dialogs/search-filters";
import type { SearchFilters, SearchResultView } from "@/components/chat/types";

import { miyuki, naoki, ryo, users, you } from "./users";

/**
 * 検索（ADR 0061）。
 *
 * 検索語は「面談」にする。**2 文字の日本語**は pg_bigm を選んだ理由そのもの（ADR 0061 の「検証の結果」）なので、
 * 画面でもその場合を見せる。大文字小文字と全角半角を吸収することも分かるよう、英語の行を 1 つ混ぜる。
 */
export const searchQuery = "面談";

/** 本文の中で塗る語。API に送る条件と同じものをそのまま渡す（決定 7）。 */
export const searchTerms = [searchQuery];

/** 結果の 1 ページ（新しい順。決定 4）。チャンネル・private・DM・スレッドの返信を 1 件ずつ混ぜる。 */
export const searchResults: SearchResultView[] = [
  {
    key: "m-1042",
    href: "#",
    room: { kind: "public", name: "デザインレビュー" },
    sender: ryo,
    timeLabel: "今日 10:42",
    body: "来週の面談の日程、火曜の午後で押さえました。面談の前に資料を共有します。",
    attachmentCount: 0,
  },
  {
    key: "m-release-1612",
    href: "#",
    room: { kind: "private", name: "リリース準備" },
    sender: naoki,
    timeLabel: "昨日 16:12",
    body: "採用の面談と重なるので、リリースの確認は木曜に動かしてもらえますか。",
    attachmentCount: 1,
  },
  {
    key: "m-thread-0930",
    href: "#",
    room: { kind: "public", name: "開発",  },
    sender: miyuki,
    timeLabel: "9月21日",
    body: "> 面談の記録はどこに置きますか\n\n共有ドライブの「面談」フォルダにまとめています。",
    inThread: true,
    attachmentCount: 0,
  },
  {
    key: "m-dm-0911",
    href: "#",
    room: { kind: "dm", name: users.miyuki.name },
    sender: you,
    timeLabel: "9月11日",
    body: "Deploy のあとで面談の時間を取れますか。ｄｅｐｌｏｙ の手順も見てもらいたいです。",
    attachmentCount: 0,
  },
];

/** 送信者と場所で絞り込んだところ（結果の画面のチップとフィルターのダイアログで同じ値を見せる）。 */
export const searchFilters: SearchFilters = {
  sender: { id: users.naoki.id, name: users.naoki.name },
  room: { id: "01J8ZH5KROOM0000000000002", kind: "private", name: "リリース準備" },
};

/** フィルターのダイアログで「場所」に打ったときに出る候補。 */
export const searchRoomOptions: RoomOption[] = [
  { id: "01J8ZH5KROOM0000000000002", kind: "private", name: "リリース準備" },
  { id: "01J8ZH5KROOM0000000000003", kind: "public", name: "リリースノート" },
];

/** 「送信者」に打ったときに出る候補。 */
export const searchSenderOptions = [users.naoki, users.miyuki];
