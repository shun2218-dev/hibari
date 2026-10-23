"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { PushNotificationState, PushNotificationView } from "@/components/settings/notification-settings";
import type { PushSubscriptionItem } from "@/lib/api/types.gen";
import { toPushDeviceView } from "@/lib/auth/devices";
import type { BrowserPushState, WebPush } from "@/lib/chat/notifications/web-push";

/**
 * 設定の「通知」の、このブラウザのプッシュ通知と「通知を受け取る端末」（ADR 0069。`settings/notifications/notifications-push*.png`）。
 *
 * 戻り値:
 * - "loading": 状態を読んでいる。画面は何も並べない（オフのスイッチを見せてから有効に変わる、を避ける）
 * - undefined: プッシュを使えない（サーバーに鍵がない・設定を読めなかった・偽のソケットのテスト）。6.14b のデスクトップ通知のカードのまま（決定 9）
 * - それ以外: カードと端末の一覧に渡す値
 *
 * 状態はデータ層（web-push.ts）の 6 つに、画面だけが持つ 2 つ（requesting・failed）を重ねて、story の 7 つにする。
 */
export function usePushSettings(push: WebPush | null): PushNotificationView | undefined | "loading" {
  const [base, setBase] = useState<BrowserPushState | "error">();
  // 有効にする操作の途中（許可の確認から、サーバーへの登録まで）。カードは requesting を出す
  const [enabling, setEnabling] = useState(false);
  // オフにする操作の途中。デザインに途中の状態はないので、押した結果（オフ）を先に見せる。失敗したら読み直して戻る
  const [disabling, setDisabling] = useState(false);
  const [failed, setFailed] = useState(false);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionItem[]>();
  // 変えた後に、状態と一覧を読み直すための世代
  const [generation, setGeneration] = useState(0);
  // 続けて押されても、前の操作が終わるまで次を始めない（購読とサーバーの登録が食い違わないように）
  const busy = useRef(false);

  // ページを開いたときの登録し直し（resync）は、この画面と並んで走る。終わると有効が変わるので、状態と一覧を読み直す
  const enabled = useSyncExternalStore(
    push?.subscribe ?? noSubscribe,
    () => push?.enabled() ?? false,
    () => false,
  );

  useEffect(() => {
    if (!push) return;
    let cancelled = false;
    push.state().then(
      (state) => {
        if (!cancelled) setBase(state);
      },
      (err: unknown) => {
        // 設定（GET /api/v1/push/config）を読めなかった。失敗の画面はデザインにないので、使えないときの表示にする
        if (cancelled) return;
        console.error("failed to read the push notification state", err);
        setBase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [push, enabled, generation]);

  useEffect(() => {
    if (!push) return;
    let cancelled = false;
    push.listDevices().then(
      (list) => {
        if (!cancelled) setSubscriptions(list.subscriptions);
      },
      (err: unknown) => {
        // 一覧の取得の失敗の画面はデザインにない（ログイン中のデバイスと同じ）。節を出さずにコンソールへ出す
        if (!cancelled) console.error("failed to list the push subscriptions", err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [push, enabled, generation]);

  // 「10月19日」は開いた時点の暦で決める（ログイン中のデバイスと同じ）
  const openedAt = useMemo(() => new Date(), []);
  const devices = useMemo(
    () => subscriptions?.map((s) => toPushDeviceView(s, openedAt)),
    [subscriptions, openedAt],
  );

  if (!push) return undefined;
  if (base === undefined) return "loading";
  if (base === "error" || base === "server-disabled") return undefined;

  function onEnabledChange(next: boolean) {
    if (!push || busy.current) return;
    busy.current = true;
    setFailed(false);
    // enable は押した操作の中でそのまま呼ぶ。Safari は、操作のあとに await を挟んだ許可の要求を拒む（web-push.ts は許可の要求を最初に呼ぶ）
    const done = next ? push.enable().then(() => undefined) : push.disable();
    if (next) setEnabling(true);
    else setDisabling(true);
    done
      .catch((err: unknown) => {
        console.error(next ? "failed to enable push notifications" : "failed to disable push notifications", err);
        // 有効にできなかったときだけ「失敗」を出す。オフにできなかったら、読み直して有効に戻るだけ（その画面はデザインにない）
        if (next) setFailed(true);
      })
      .finally(() => {
        busy.current = false;
        setEnabling(false);
        setDisabling(false);
        setGeneration((n) => n + 1);
      });
  }

  async function onStopDevice(subscriptionId: string) {
    if (!push) return;
    try {
      await push.stopDevice(subscriptionId);
      setSubscriptions((current) => current?.filter((s) => s.id !== subscriptionId));
    } catch (err) {
      // すでに止まっていれば 404。読み直すと消える
      console.error("failed to stop the push subscription", err);
    }
    setGeneration((n) => n + 1);
  }

  return {
    state: displayState(base, { enabling, disabling, failed }),
    onEnabledChange,
    devices,
    onStopDevice: (id) => void onStopDevice(id),
  };
}

function displayState(
  base: Exclude<BrowserPushState, "server-disabled">,
  { enabling, disabling, failed }: { enabling: boolean; disabling: boolean; failed: boolean },
): PushNotificationState {
  if (enabling) return "requesting";
  if (disabling) return "off";
  // 失敗したらスイッチはオフ。許可が拒否に変わっていたら、そちらを出す（もう押しても何も起きないので）
  if (failed && base === "off") return "failed";
  return base;
}

function noSubscribe() {
  return () => {};
}
