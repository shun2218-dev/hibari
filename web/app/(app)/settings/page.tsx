"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { SettingsMobileMenu } from "@/components/settings/settings-layout";

import { settingsHrefs } from "./settings-shell";

/** md 以上（左にナビが出る幅）では、この一覧は出さずに最初の項目を開く。 */
const DESKTOP = "(min-width: 768px)";

/**
 * 設定の入口（`/settings`）。モバイルは項目の一覧（`settings/nav/mobile-list.png`）、
 * デスクトップは一覧が左のナビと重なるので、プロフィールに移る。
 */
export default function Page() {
  const router = useRouter();

  useEffect(() => {
    if (window.matchMedia(DESKTOP).matches) router.replace(settingsHrefs.profile);
  }, [router]);

  return <SettingsMobileMenu hrefs={settingsHrefs} chatHref="/" />;
}
