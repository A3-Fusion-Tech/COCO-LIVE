import { createServer, type Server } from "node:http";
import { parseLocale } from "../../../packages/localization/src/index.ts";
import { renderPricesPage, type PriceItem } from "./render.ts";

const SW = `const C="lc-v1";self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))})`;
const MANIFEST = JSON.stringify({ name: "LiveCoco", short_name: "LiveCoco", start_url: "/", display: "standalone", lang: "ta", background_color: "#ffffff", theme_color: "#2e7d32", icons: [] });

export function createWeb(apiBaseUrl: string, fetchImpl: typeof fetch = fetch): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/sw.js") { res.writeHead(200, { "content-type": "text/javascript" }); return void res.end(SW); }
    if (url.pathname === "/manifest.webmanifest") { res.writeHead(200, { "content-type": "application/manifest+json" }); return void res.end(MANIFEST); }
    if (url.pathname !== "/") { res.writeHead(404); return void res.end("Not found"); }
    const locale = parseLocale(req.headers["accept-language"], url.searchParams.get("lang"));
    try {
      const [prices, msp] = await Promise.all([fetchImpl(`${apiBaseUrl}/v1/prices/latest`).then((r) => r.json()), fetchImpl(`${apiBaseUrl}/v1/prices/msp`).then((r) => r.json())]);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
      res.end(renderPricesPage((prices as { items: PriceItem[] }).items, (msp as { items: never[] }).items, locale));
    } catch {
      // Source/API trouble degrades the page instead of breaking it
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "30" });
      res.end("Prices temporarily unavailable");
    }
  });
}

if (process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  createWeb(process.env.API_BASE_URL ?? "http://localhost:4000").listen(port, () => console.log(`web listening on ${port}`));
}
