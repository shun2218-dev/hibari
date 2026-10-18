import { createAccount } from "./account";
import { type SessionOptions, createSessionCore } from "./core";
import { createDevices } from "./devices";
import { createEmail } from "./email";
import { createProfile } from "./profile";

/**
 * Web クライアントの認証の状態と、Access Token を付けた API の呼び出し。
 *
 * 状態と Access Token の扱いは core.ts にあり、エンドポイントごとの呼び出しは
 * account / email / profile / devices に分けてある。ここは組み立てて 1 つにまとめるだけ。
 */
export function createSession(options: SessionOptions) {
  const core = createSessionCore(options);
  const account = createAccount(core);
  const email = createEmail(core);
  const profile = createProfile(core);
  const devices = createDevices(core);

  return {
    ...core.actions,
    ...account,
    ...email,
    ...profile,
    ...devices,
  };
}

export type Session = ReturnType<typeof createSession>;
