import { settingsTitles } from "@/components/settings/settings-layout";
import { titleParts } from "@/lib/document-title";

import { AppearanceSection } from "@/app/(app)/settings/appearance/_components/appearance-section";

export const metadata = { title: titleParts(settingsTitles.appearance, "設定") };

export default function Page() {
  return <AppearanceSection />;
}
