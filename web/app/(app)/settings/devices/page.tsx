import { settingsTitles } from "@/components/settings/settings-layout";
import { titleParts } from "@/lib/document-title";

import { DevicesSection } from "@/app/(app)/settings/devices/_components/devices-section";

export const metadata = { title: titleParts(settingsTitles.devices, "設定") };

export default function Page() {
  return <DevicesSection />;
}
