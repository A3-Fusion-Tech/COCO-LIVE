import { manifest } from "../../src/gateway.ts";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => manifest(req);
