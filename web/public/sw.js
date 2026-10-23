/*
 * hibari の Service Worker（ADR 0069）。プッシュ通知を出し、押したら hibari を開く。
 *
 * - サイトの直下（/sw.js）に置くのは、スコープを / にするため（Service-Worker-Allowed の見出しを足さずに済む）
 * - ビルドを通さない素の JS にしている。Next.js は Service Worker を別のファイルとして書き出す仕組みを持たず、
 *   そのためだけにバンドラを足さない。import を持たない 1 ファイルなので、そのまま配れる
 * - fetch は扱わない（キャッシュを持たない）。オフラインで開く機能は作っていないので、画面の読み込みに割り込まない
 * - 判断は上の純粋な関数に置き、下の addEventListener は薄くつなぐだけにする。テスト（lib/chat/notifications/service-worker.test.ts。public/ に置くと配られるので）はこのファイルを
 *   偽の self で読み込んで、関数とイベントの両方を確かめる
 *
 * トークンも設定も持たない。出すのに要るものは、サーバーが暗号化して送るペイロードにすべて入っている（docs/events.md）。
 */
"use strict";

/** 通知のアイコン。hibari のマーク（make brand が docs/ui/brand/mark.svg から書き出す）。 */
const ICON = "/notification-icon.png";
/** ページに「この URL を開いて」と頼む知らせ。ページの側は lib/chat/notifications/service-worker-open.ts。 */
const OPEN_MESSAGE = "hibari:open";
/** ページが応えるのを待つ時間。応えなければ（hibari のチャットの画面ではない）、そのタブを読み込み直して開く。 */
const OPEN_ACK_TIMEOUT_MS = 1000;
/** ペイロードが読めないときのタイトル。Chrome は、プッシュを受けたら必ず通知を出すことを求める。 */
const FALLBACK_TITLE = "hibari";

/**
 * 押したときに開くパス。サイトの中のパス（/ で始まり、// ではない）だけを受け、それ以外は / にする。
 * ペイロードはサーバーが作るものだが、よそのサイトを開く入口にしない。
 */
function safePath(url) {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return "/";
  return url;
}

/** ペイロード（docs/events.md の「プッシュ通知のペイロード」）を読む。形が合わなければ null。 */
function parsePayload(data) {
  if (!data || typeof data !== "object") return null;
  const { type, title, body, tag, group_title: groupTitle, url } = data;
  if (type !== "message" && type !== "huddle") return null;
  if (typeof title !== "string" || typeof tag !== "string" || tag === "") return null;
  return {
    type,
    title,
    body: typeof body === "string" ? body : "",
    tag,
    groupTitle: typeof groupTitle === "string" && groupTitle !== "" ? groupTitle : title,
    url: safePath(url),
  };
}

/** 出ている通知がまとめている件数。hibari が出したものでなければ 1 件と数える。 */
function countOf(data) {
  return data && Number.isInteger(data.count) && data.count > 0 ? data.count : 1;
}

/**
 * 出す通知（ADR 0069 決定 7・docs/ui の「届く通知の中身」）。existing は同じ tag ですでに出ている通知の data。
 *
 * - メッセージは、同じ tag（ルーム。スレッドの返信は親）の通知があれば 1 つにまとめる。タイトルを group_title にし、
 *   本文を「新しいメッセージが N 件あります」とその下に最後の 1 件にする。同じ tag で出すと OS が前のものを置き換える
 * - ハドルの呼び出しはまとめない（同じハドルの呼び出しが届き直しても 1 件のまま）
 * - まとめて置き換えるときも、新しい通知として知らせる（renotify。置き換えだけだと音も表示も出ないブラウザがある）
 */
function notificationFor(payload, existing) {
  const previous = payload.type === "message" ? existing.reduce((n, data) => n + countOf(data), 0) : 0;
  const count = previous + 1;
  const grouped = count > 1;
  const body = grouped ? [`新しいメッセージが ${count} 件あります`, payload.body].filter((line) => line !== "").join("\n") : payload.body;
  return {
    title: grouped ? payload.groupTitle : payload.title,
    options: {
      body,
      tag: payload.tag,
      icon: ICON,
      renotify: existing.length > 0,
      data: { type: payload.type, url: payload.url, count },
    },
  };
}

/** 読めないペイロードのときの通知。 */
function fallbackNotification() {
  return { title: FALLBACK_TITLE, options: { tag: FALLBACK_TITLE, icon: ICON, data: { type: "message", url: "/", count: 1 } } };
}

/** 前に出すタブ。いまフォーカスのあるもの、見えているもの、どれか、の順に選ぶ。 */
function pickClient(windows) {
  return windows.find((c) => c.focused) ?? windows.find((c) => c.visibilityState === "visible") ?? windows[0];
}

/**
 * タブのページに、読み込み直さずにその URL へ移るよう頼む（ADR 0042。ハドルの通話を切らないため）。
 * ページが応えたら true。チャットの画面ではない・応えないなら、待ち時間のあとに false。
 */
function askToOpen(client, url, timeoutMs) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, timeoutMs);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(true);
    };
    client.postMessage({ type: OPEN_MESSAGE, url }, [channel.port2]);
  });
}

/** 通知を押したとき。開いている hibari のタブを前に出してその URL へ移り、なければ新しく開く（決定 7）。 */
async function openFromNotification(clients, url) {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = pickClient(windows);
  if (!client) {
    await clients.openWindow(url);
    return;
  }
  // フォーカスは押した直後でないと許されないので、ページの返事を待つより先に呼ぶ
  await client.focus().catch(() => {});
  if (await askToOpen(client, url, OPEN_ACK_TIMEOUT_MS)) return;
  try {
    await client.navigate(url);
  } catch {
    // この Service Worker が受け持っていないタブは navigate できない
    await clients.openWindow(url);
  }
}

/**
 * ブラウザが購読を作り直した・失ったとき。Service Worker はトークンを持たず API を呼べないので、ここでは購読を作り直すだけにし、
 * サーバーへの登録はページを開いたときの PUT に任せる（決定 4）。ブラウザが新しい購読を渡してきたら何もしない。
 */
async function resubscribe(registration, oldSubscription, newSubscription) {
  if (newSubscription) return;
  const key = oldSubscription && oldSubscription.options ? oldSubscription.options.applicationServerKey : null;
  if (!key) return;
  await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/** ペイロードを JSON として読む。読めなければ null。 */
function readPushData(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

// ---- イベントのつなぎ ----

// 新しい版はすぐに入れ替える。fetch を扱わないので、開いているページの途中で替わっても困らない
self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = parsePayload(readPushData(event));
  event.waitUntil(
    (async () => {
      if (!payload) {
        const { title, options } = fallbackNotification();
        await self.registration.showNotification(title, options);
        return;
      }
      const existing = await self.registration.getNotifications({ tag: payload.tag });
      const { title, options } = notificationFor(
        payload,
        existing.map((n) => n.data),
      );
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openFromNotification(self.clients, safePath(data && data.url)));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(self.registration, event.oldSubscription, event.newSubscription));
});
