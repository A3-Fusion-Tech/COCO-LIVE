import { NextResponse, type NextRequest } from "next/server";
import { appCsp } from "./src/gateway.ts";

/** Redirects `/app` to `/app/` and gives each app page a fresh CSP nonce, which Next.js puts on its own scripts. */
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/app") return NextResponse.redirect(new URL("/app/", req.url), 301);
  const nonce = btoa(crypto.randomUUID());
  const csp = appCsp(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(req.headers);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-content-type-options", "nosniff");
  return res;
}

export const config = { matcher: ["/app", "/app/"] };
