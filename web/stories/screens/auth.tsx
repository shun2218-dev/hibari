"use client";

import type { ReactNode } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

import { noHref } from "./shared";

/**
 * ログイン・登録・パスワードの再設定の画面（ADR 0024）。
 */
// ---- 認証 ----

export const goodStrength = { level: 3, label: "良い" } as const;

export function auth(children: ReactNode, footer?: ReactNode) {
  return <AuthShell footer={footer}>{children}</AuthShell>;
}

export function login(error?: "credentials" | "rate_limited") {
  return auth(<LoginForm error={error} forgotPasswordHref={noHref} signupHref={noHref} />);
}
