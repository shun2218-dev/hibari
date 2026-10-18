import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { REPOSITORY_URL } from "@/lib/links";
import { arrangeTree } from "@/lib/page-tree";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={arrangeTree(source.getPageTree())} nav={{ title: "hibari docs" }} githubUrl={REPOSITORY_URL}>
      {children}
    </DocsLayout>
  );
}
