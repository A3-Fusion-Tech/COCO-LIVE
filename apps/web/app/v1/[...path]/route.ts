import { gatewayConfig, proxyApi } from "../../../src/gateway.ts";

/** Same-origin API gateway: every method is forwarded with the session attached (see `proxyApi`). */
export const dynamic = "force-dynamic";
const handle = (req: Request) => proxyApi(req, gatewayConfig());
export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
