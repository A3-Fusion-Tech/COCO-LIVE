/** Minimal runtime validation helpers shared by the API (no external schema dependency). */
export interface FieldError {
  field: string;
  code: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  messageKey: string;
  detail: string;
  correlationId: string;
  fieldErrors: FieldError[];
}

export const problem = (status: number, code: string, title: string, detail: string, correlationId: string, fieldErrors: FieldError[] = [], messageKey = `error.${code.toLowerCase()}`): Problem => ({
  type: `https://docs.livecoco.example/problems/${code.toLowerCase().replace(/_/g, "-")}`,
  title,
  status,
  code,
  messageKey,
  detail,
  correlationId,
  fieldErrors,
});

export const page = <T>(items: T[], nextCursor: string | null = null) => ({ items, page: { nextCursor, hasMore: nextCursor !== null } });

export function paginate<T>(all: T[], cursor: string | null, limit: number, key: (t: T) => string): ReturnType<typeof page<T>> {
  const sorted = [...all].sort((a, b) => key(a).localeCompare(key(b)));
  const start = cursor ? sorted.findIndex((x) => key(x) > Buffer.from(cursor, "base64url").toString()) : 0;
  if (start < 0) return page([]);
  const slice = sorted.slice(start, start + limit);
  const more = start + limit < sorted.length;
  const last = slice[slice.length - 1];
  return page(slice, more && last ? Buffer.from(key(last)).toString("base64url") : null);
}

export type Shape = Record<string, (v: unknown) => boolean>;
export const is = {
  string: (v: unknown) => typeof v === "string" && v.length > 0,
  optString: (v: unknown) => v === undefined || typeof v === "string",
  int: (v: unknown) => Number.isSafeInteger(v),
  bool: (v: unknown) => typeof v === "boolean",
  iso: (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v)),
  oneOf: (...xs: string[]) => (v: unknown) => typeof v === "string" && xs.includes(v),
  stringArray: (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  object: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
};

export function check(body: unknown, shape: Shape): FieldError[] {
  const b = (is.object(body) ? body : {}) as Record<string, unknown>;
  return Object.entries(shape)
    .filter(([k, f]) => !f(b[k]))
    .map(([field]) => ({ field, code: b[field] === undefined ? "REQUIRED" : "INVALID" }));
}
