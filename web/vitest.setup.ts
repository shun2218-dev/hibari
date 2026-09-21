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

// jsdom は Range の座標（CSSOM View）を持たない。入力欄の Lexical（ADR 0052）はキャレットの位置を測るので、
// 大きさ 0 の矩形を返しておく（位置の計算そのものは lib/anchored-position.test.ts で確かめている）。
if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
}
// Lexical の補完（typeahead）は入力欄の大きさの変化を ResizeObserver で見る。jsdom は大きさを計算しないので、何もしないものでよい
if (typeof window !== "undefined" && typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// Lexical の貼り付け（ADR 0052 決定 5）は、イベントが DragEvent かどうかを見る。jsdom は DragEvent を持たない
if (typeof window !== "undefined" && typeof window.DragEvent === "undefined") {
  window.DragEvent = class extends MouseEvent {} as unknown as typeof DragEvent;
}
// 同じく ClipboardEvent も持たない
if (typeof window !== "undefined" && typeof window.ClipboardEvent === "undefined") {
  window.ClipboardEvent = class extends Event {} as unknown as typeof ClipboardEvent;
}
