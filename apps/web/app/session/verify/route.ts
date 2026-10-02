import { gatewayConfig, verifySession } from "../../../src/gateway.ts";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => verifySession(req, gatewayConfig());
