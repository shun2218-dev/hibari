import { type Problem, type ProblemFieldError, type ProblemType, PROBLEM_TYPE_PREFIX } from "./types.gen";

/**
 * API が 2xx 以外を返したときのエラー。
 *
 * 画面は `type`（Problem の type から接頭辞を除いたもの）と `fieldErrors` の `reason` で分岐し、
 * `title` は表示に使わない（文言は UI 側で持つ。ADR 0010）。
 */
export class ApiError extends Error {
  readonly status: number;
  /** Problem 以外のボディ（プロキシのエラーページなど）なら undefined。 */
  readonly type: ProblemType | undefined;
  readonly fieldErrors: readonly ProblemFieldError[];
  /** 429 の Retry-After（秒）。 */
  readonly retryAfterSeconds: number | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, problem: Problem | undefined, retryAfterSeconds?: number) {
    super(`API responded ${status}${problem ? ` (${problem.type})` : ""}`);
    this.name = "ApiError";
    this.status = status;
    this.type = problem?.type.startsWith(PROBLEM_TYPE_PREFIX)
      ? (problem.type.slice(PROBLEM_TYPE_PREFIX.length) as ProblemType)
      : undefined;
    this.fieldErrors = problem?.errors ?? [];
    this.retryAfterSeconds = retryAfterSeconds;
    this.requestId = problem?.request_id;
  }
}

/** レスポンスから ApiError を作る。ボディが Problem でなくても投げられる形にする。 */
export async function apiErrorFrom(res: Response): Promise<ApiError> {
  let problem: Problem | undefined;
  if (res.headers.get("Content-Type")?.startsWith("application/problem+json")) {
    try {
      problem = (await res.json()) as Problem;
    } catch {
      // 壊れたボディでも、ステータスだけで扱えるようにする。
    }
  }
  const retryAfter = Number(res.headers.get("Retry-After"));
  return new ApiError(res.status, problem, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
}
