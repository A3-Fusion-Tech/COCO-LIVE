import { health } from "../../src/gateway.ts";

export const dynamic = "force-dynamic";
export const GET = () => health();
