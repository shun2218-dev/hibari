import { createOpenAPI } from "fumadocs-openapi/server";

/** Go の型から生成した REST の API リファレンス（ADR 0064 決定 5。`make openapi`）。 */
export const openapi = createOpenAPI({
  input: ["../docs/api/openapi.json"],
});
