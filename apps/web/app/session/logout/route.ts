import { logout } from "../../../src/gateway.ts";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => logout(req);
