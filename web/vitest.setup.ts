import "@testing-library/jest-dom/vitest";
import { setProjectAnnotations } from "@storybook/react";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

import * as previewAnnotations from "./.storybook/preview";

// story を素のテストから描けるようにする（portable stories。ADR 0047 決定 6）。
// .storybook/preview.tsx の decorator（テーマと書体）も、こちら側で同じように当たる。
const annotations = setProjectAnnotations([previewAnnotations]);
beforeAll(annotations.beforeAll);

afterEach(() => {
  cleanup();
});
