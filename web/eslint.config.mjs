import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 親の階層へ上がる import は @/ から書く（ADR 0060 決定 6）。ファイルを動かしても、指す側を直さずに済む。
    // 同じディレクトリの中（./）は一緒に動くので相対のままでよい。
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["../*"], message: "親の階層へ上がる import は @/ から書く（ADR 0060）。" }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // storybook build の出力（生成物）。
    "storybook-static/**",
  ]),
]);

export default eslintConfig;
