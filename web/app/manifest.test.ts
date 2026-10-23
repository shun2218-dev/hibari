import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { metadata as lpMetadata } from "./lp/page";
import manifest from "./manifest";

const web = path.dirname(import.meta.dirname);

/** globals.css の @theme（ライト）にある色の値。 */
function lightToken(name: string): string {
  const css = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");
  const theme = css.slice(css.indexOf("@theme static {"));
  const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, "iu").exec(theme)?.[1];
  if (!value) throw new Error(`token not found: ${name}`);
  return value;
}

/** PNG の IHDR から幅と高さを読む。 */
function pngSize(file: string): string {
  const png = readFileSync(file);
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

describe("manifest（ADR 0069 決定 1）", () => {
  const m = manifest();

  it("ホーム画面から standalone で開く（iPhone はそれでプッシュを受け取れる）", () => {
    expect(m).toMatchObject({
      id: "/",
      name: "hibari",
      short_name: "hibari",
      start_url: "/",
      scope: "/",
      display: "standalone",
      lang: "ja",
    });
  });

  it("色は globals.css のページの地（ライト）と同じ", () => {
    expect(m.background_color).toBe(lightToken("--color-background"));
    expect(m.theme_color).toBe(lightToken("--color-background"));
  });

  it("アイコンは 192px と 512px の PNG で、書いた大きさのファイルが public/ にある（make brand）", () => {
    expect(m.icons?.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
    for (const icon of m.icons ?? []) {
      expect(icon.type).toBe("image/png");
      expect(pngSize(path.join(web, "public", icon.src))).toBe(icon.sizes);
    }
  });

  it("LP のページは manifest の link を外す（LP のホストでは 404 になり、LP をアプリにしない）", () => {
    expect(lpMetadata.manifest).toBeNull();
  });
});
