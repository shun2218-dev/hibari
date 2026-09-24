/**
 * タブのタイトル（ADR 0063 決定 2）。
 *
 * 形は Slack と同じく「開いているもの - ワークスペース名 - N 個の新しいアイテム - hibari」で、区切りは ` - `。
 * 固定のタイトルは各ページの `metadata` が root の template（`%s - hibari`）で組み立てる。
 * 名前が要るタイトル（ワークスペース名・ルーム名・アクティビティの数）は、描くサーバーが名前を知らないので、
 * ここで組み立ててブラウザで `document.title` に入れる（useDocumentTitle）。
 */

export const APP_NAME = "hibari";

/** LP にもアプリにも同じものを使う（ADR 0063 決定 1）。 */
export const APP_DESCRIPTION = "ワークスペースとチャンネルで話す、リアルタイムチャット。";

export const TITLE_SEPARATOR = " - ";

/** LP のタイトル（ADR 0063 決定 1）。LP だけは開いているものがないので、アプリ名を先に置き、説明を続ける（句点は付けない）。 */
export const LP_TITLE = `${APP_NAME}${TITLE_SEPARATOR}${APP_DESCRIPTION.replace(/。$/, "")}`;

/** root の `metadata.title.template`。固定のタイトルとブラウザで組み立てるタイトルの形をそろえるため、ここに置く。 */
export const TITLE_TEMPLATE = `%s${TITLE_SEPARATOR}${APP_NAME}`;

/** 空の部分を飛ばして ` - ` で並べる。アプリ名は付けない（ページの `metadata` は template が付ける）。 */
export function titleParts(...parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part !== "").join(TITLE_SEPARATOR);
}

/** 空の部分を飛ばして並べ、最後にアプリ名を付ける。 */
export function documentTitle(...parts: (string | undefined)[]): string {
  return titleParts(...parts, APP_NAME);
}

/**
 * アクティビティの数（左のメニューのバッジと同じ数。ADR 0058）。0 のときは部分ごと省く。
 * 数字と「個」の間に空白を入れるのは、画面の「未読 3 件」「3 件の返信」と同じ書き方。
 */
export function activityPart(count: number): string | undefined {
  return count > 0 ? `${count} 個の新しいアイテム` : undefined;
}

/**
 * チャットの画面のタイトル。`main` はメインの領域に出ているもの（ルーム名、DM は相手の表示名、「スレッド」）。
 * ルーム名に `#` も鍵も付けない。名前がまだ読めていなければ、読めた部分だけで組み立てる。
 */
export function chatTitle({
  main,
  workspaceName,
  activity,
}: {
  main?: string;
  workspaceName?: string;
  activity: number;
}): string {
  return documentTitle(main, workspaceName, activityPart(activity));
}
