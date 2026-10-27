/** Liveness probe for the web tier (does not call the API). */
export const dynamic = "force-dynamic";
export const GET = () => Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
