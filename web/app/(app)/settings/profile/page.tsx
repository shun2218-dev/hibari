import { settingsTitles } from "@/components/settings/settings-layout";
import { titleParts } from "@/lib/document-title";

import { ProfileSection } from "@/app/(app)/settings/profile/_components/profile-section";

export const metadata = { title: titleParts(settingsTitles.profile, "設定") };

export default function Page() {
  return <ProfileSection />;
}
