import type { PushConfig, PushSubscriptionItem, PushSubscriptionList, PushSubscriptionRequest } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/auth-session";

/**
 * プッシュ通知の設定と購読（ADR 0069 決定 4）。購読はいまのセッション（sid）に 1 つなので、自分の購読は単数のパスで扱う。
 */
export function createPushApi(request: Session["request"]) {
  return {
    /** VAPID の公開鍵。サーバーに鍵がなければ enabled: false（決定 9）。 */
    getPushConfig: () => request<PushConfig>("GET", "/api/v1/push/config"),

    /** いまのセッションの購読を登録する（冪等。同じ sid で別の endpoint なら置き換わる。決定 3）。 */
    putPushSubscription: (subscription: PushSubscriptionRequest) =>
      request<PushSubscriptionItem>("PUT", "/api/v1/me/push-subscription", subscription),

    /** いまのセッションの購読を消す（このブラウザで止めたとき）。なくても 204。 */
    deletePushSubscription: () => request<void>("DELETE", "/api/v1/me/push-subscription"),

    /** 自分の購読の一覧（設定の「通知を受け取る端末」）。 */
    listPushSubscriptions: () => request<PushSubscriptionList>("GET", "/api/v1/me/push-subscriptions"),

    /** ほかの端末の購読を止める。他人のものやないものは 404。 */
    deletePushSubscriptionById: (subscriptionId: string) =>
      request<void>("DELETE", `/api/v1/me/push-subscriptions/${encodeURIComponent(subscriptionId)}`),
  };
}

export type PushApi = ReturnType<typeof createPushApi>;
