/** RFC 9457 problem details as the API sends them (`application/problem+json`; see docs/api/conventions.md §5). */
export interface FieldError { field: string; code?: string; message?: string }
export interface Problem {
  status: number;
  type?: string;
  title?: string;
  code?: string;
  messageKey?: string;
  /** Localised by the API from `accept-language`. */
  message?: string;
  detail?: string;
  correlationId?: string;
  fieldErrors?: FieldError[];
}

/** Any failed API call: an upstream problem response, an unreachable API (503 `UNAVAILABLE`) or invalid input. */
export class ApiError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.message ?? problem.title ?? problem.code ?? `HTTP ${problem.status}`);
    this.name = "ApiError";
    this.problem = problem;
  }
  get status() { return this.problem.status; }
  get code() { return this.problem.code; }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export const unavailable = () => new ApiError({ status: 503, code: "UNAVAILABLE", title: "API unreachable" });
export const invalidInput = (detail: string) => new ApiError({ status: 400, code: "INVALID_INPUT", title: "Invalid input", detail, message: detail });

/** Reads a failed response as a problem; bodies that are not JSON still yield the status. */
export async function problemFromResponse(res: Response): Promise<Problem> {
  const text = await res.text().catch(() => "");
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  const p = body && typeof body === "object" ? (body as Partial<Problem>) : {};
  return { ...p, status: res.status };
}

/** One line for the user: field names for validation errors, else the localised message, else `fallback`. */
export function describeProblem(p: Problem, fallback: string): string {
  if (p.fieldErrors?.length) return `${p.message ?? p.title ?? fallback}: ${p.fieldErrors.map((f) => f.field).join(", ")}`;
  if (p.code === "VALIDATION_FAILED" && p.detail) return p.detail;
  return p.message ?? p.detail ?? fallback;
}
