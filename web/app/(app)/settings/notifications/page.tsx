import { settingsTitles } from "@/components/settings/settings-layout";
import { titleParts } from "@/lib/document-title";

import { NotificationsSection } from "@/app/(app)/settings/notifications/_components/notifications-section";

export const metadata = { title: titleParts(settingsTitles.notifications, "設定") };

export default function Page() {
  return <NotificationsSection />;
}
