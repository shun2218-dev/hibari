"use client";

import { createOpenAPIPage } from "fumadocs-openapi/ui";

// 「試しに送る」は出さない。サイトから本番の API を叩かせる理由がない（ADR 0064 決定 5）
export const OpenAPIPage = createOpenAPIPage({ playground: { enabled: false } });
