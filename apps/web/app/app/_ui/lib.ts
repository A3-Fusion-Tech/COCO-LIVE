import { UI } from "../../../src/i18n.ts";

export type Lang = "ta" | "en";
/** API payloads are rendered as returned; their contracts are validated by the API, not re-declared here. */
export type Json = any;
export interface Me { userId: string; displayName: string; actingAs: string; locale: string; capabilities: string[]; claims: { type: string; status: string }[] }
export interface Catalog { products: { productId: string; name: Record<Lang, string>; units?: string[] }[]; markets: { marketId: string; name: Record<Lang, string> }[] }
export interface Problem { code?: string; title?: string; message?: string; detail?: string; status?: number; fieldErrors?: { field: string }[] }

export const translate = (lang: Lang, k: string) => UI[lang][k] ?? UI.en[k] ?? k;

export class ApiError extends Error {
  readonly problem: Problem;
  constructor(p: Problem) { super(p.message ?? p.title ?? p.code ?? "error"); this.problem = p; }
}
export const problemOf = (e: unknown): Problem => (e instanceof ApiError ? e.problem : {});

/** Same-origin call through the web gateway; the session cookie is attached server-side. */
export async function apiCall(lang: Lang, method: string, path: string, body?: unknown, opts: { key?: string } = {}): Promise<Json> {
  const headers: Record<string, string> = { "x-requested-with": "livecoco", "accept-language": lang };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = opts.key ?? crypto.randomUUID();
  let res: Response;
  try { res = await fetch(`${path}${path.includes("?") ? "&" : "?"}lang=${lang}`, { method, headers, credentials: "same-origin", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new ApiError({ code: "OFFLINE", message: translate(lang, "err.offline") }); }
  const text = await res.text();
  let data: Json = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError({ ...data, status: res.status });
  return data;
}

export const money = (lang: Lang, paise: number) => new Intl.NumberFormat(lang === "ta" ? "ta-IN" : "en-IN", { style: "currency", currency: "INR", minimumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
export const when = (lang: Lang, iso: string) => new Intl.DateTimeFormat(lang === "ta" ? "ta-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
/** Rupees as typed ("30", "30.5") to integer paise, without floating-point arithmetic. */
export function toPaise(v: string): number {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(String(v));
  if (!m) throw new ApiError({ message: `Invalid amount: ${v}` });
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}
export const hoursFromNow = (n: number) => new Date(Date.now() + n * 3600000).toISOString();
export const localIso = (v: string) => new Date(v).toISOString();
export const csv = (v: string) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
