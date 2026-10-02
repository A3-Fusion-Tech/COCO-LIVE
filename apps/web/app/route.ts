import { gatewayConfig, pricePage } from "../src/gateway.ts";

/**
 * Public price page, server-rendered per request. A Route Handler rather than a page because App Router
 * pages cannot answer 503 or set `cache-control: public, max-age=60`, both of which this page relies on.
 */
export const dynamic = "force-dynamic";
export const GET = (req: Request) => pricePage(req, gatewayConfig());
