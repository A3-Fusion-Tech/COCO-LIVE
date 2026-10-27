/** Web-tier runtime configuration. Read from the environment per request, never inlined at build time. */
export interface GatewayConfig {
  /** API origin without a trailing slash. */
  apiBaseUrl: string;
  /** Mark the session cookie `Secure`. */
  secureCookies: boolean;
  /**
   * The web tier runs behind a reverse proxy that appends the client address to `x-forwarded-for`. Only then is
   * that header believed (its last entry, the one the proxy wrote); otherwise no client address is forwarded.
   */
  trustProxy: boolean;
  fetchImpl?: typeof fetch;
}

type Env = Record<string, string | undefined>;
const flag = (v: string | undefined) => v === "1" || v === "true";

export function gatewayConfig(env: Env = process.env): GatewayConfig {
  return {
    apiBaseUrl: (env.API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, ""),
    secureCookies: env.COOKIE_SECURE ? flag(env.COOKIE_SECURE) : env.NODE_ENV === "production",
    trustProxy: flag(env.TRUST_PROXY),
  };
}

/**
 * The client address to forward to the API, which rate-limits on it. A client can put anything in
 * `x-forwarded-for` and Next.js passes a client-sent value through unchanged, so the header is only used when
 * `TRUST_PROXY` says a reverse proxy in front of us appended the real peer address, and then only its last entry.
 * Without a trusted proxy we return `undefined` and the API sees the web tier's own address instead.
 */
export function clientIp(headers: Pick<Headers, "get">, cfg: Pick<GatewayConfig, "trustProxy">): string | undefined {
  if (!cfg.trustProxy) return undefined;
  const last = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).at(-1);
  return last && /^[0-9A-Fa-f:.]{2,45}$/.test(last) ? last : undefined;
}
