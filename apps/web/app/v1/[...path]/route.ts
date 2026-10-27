import { gatewayConfig } from "../../../lib/gateway/config.ts";
import { proxyApi } from "../../../lib/gateway/proxy.ts";

/** Same-origin `/v1/*` proxy to the API (see `lib/gateway/proxy.ts` for what it enforces). */
export const dynamic = "force-dynamic";
const handle = (req: Request) => proxyApi(req, gatewayConfig());
export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
