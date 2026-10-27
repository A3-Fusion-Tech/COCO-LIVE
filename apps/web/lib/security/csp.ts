/**
 * Content Security Policies, set by `proxy.ts`.
 *
 * App pages render per request, so they get a fresh nonce: Next.js reads it from the request's CSP header and
 * puts it on its own inline and external scripts. `next dev` additionally needs `eval` and inline styles for
 * React's dev tooling and error overlay.
 */
export function appCsp(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    "img-src 'self' blob: data:",
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * The public price board is statically regenerated (ISR) and shared by every visitor, so it cannot carry a
 * per-request nonce; Next's inline bootstrap scripts need `'unsafe-inline'` there. The page has no forms, no user
 * data and no third-party content.
 */
export function boardCsp(dev = false): string {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** A base64 nonce from 16 random bytes. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
