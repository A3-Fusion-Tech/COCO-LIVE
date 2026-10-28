/**
 * The API session token lives only in this cookie: HttpOnly (never visible to page JavaScript), SameSite=Strict
 * (never sent on cross-site requests), `Secure` in production. Server components and server actions read it and
 * attach it as `Authorization: Bearer`; it is never returned in a response body.
 */
export const SESSION_COOKIE = "lc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export interface CookieOptions { httpOnly: true; sameSite: "strict"; secure: boolean; path: "/"; maxAge: number }

export const sessionCookieOptions = (secure: boolean, maxAge = SESSION_MAX_AGE): CookieOptions => ({ httpOnly: true, sameSite: "strict", secure, path: "/", maxAge });

/** `Set-Cookie` value for the session (or for clearing it, with an empty token and `maxAge` 0). */
export function serializeSessionCookie(token: string, opts: CookieOptions): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${opts.maxAge}${opts.secure ? "; Secure" : ""}`;
}

/** Reads one cookie from a `Cookie` header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

/** Post-login destination from `?next=`: same-origin paths only, so the login page cannot be used as an open redirect. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}
