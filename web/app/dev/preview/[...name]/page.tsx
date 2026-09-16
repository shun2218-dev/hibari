import { notFound } from "next/navigation";

import { findPreviewEntry } from "../catalog";
import { PreviewScreen } from "../screens";

export async function generateMetadata({ params }: PageProps<"/dev/preview/[...name]">) {
  const { name } = await params;
  return { title: `${name.join("/")} / dev preview` };
}

export default async function PreviewPage({ params }: PageProps<"/dev/preview/[...name]">) {
  if (process.env.NODE_ENV === "production") notFound();

  const { name } = await params;
  const entry = findPreviewEntry(name.join("/"));
  if (!entry) notFound();

  return <PreviewScreen name={entry.name} dark={entry.dark ?? false} />;
}
