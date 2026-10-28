import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Empty } from "../../../../_components/ui.tsx";
import { getApi, getNames, getT, load, requireMe } from "../../../../_lib/server.ts";

/** One of the buyer's requirements with the market lots it matches. */
export default async function RequirementPage({ params }: { params: Promise<{ requirementId: string }> }) {
  await requireMe();
  const { requirementId } = await params;
  const [api, t, names] = await Promise.all([getApi(), getT(), getNames()]);
  const req = (await load(api.myBuyRequirements())).items.find((r) => r.requirementId === requirementId);
  if (!req) notFound();
  const matches = await load(api.requirementMatches(requirementId));
  return (
    <>
      <p><Link href="/buy">{`← ${t("common.back")}`}</Link></p>
      <h1>{`${names.product(req.productId)} — ${req.targetQuantity} ${req.unit}`}</h1>
      <Badge t={t} status={req.status} />
      <h2>{t("buy.matches")}</h2>
      {matches.items.length
        ? <ul>{matches.items.map((m) => <li key={m.sellLotId}><Link href={`/market/${encodeURIComponent(m.sellLotId)}`}>{m.sellLotId}</Link>{` · ${m.score} · ${m.reasons.join(", ")}`}</li>)}</ul>
        : <Empty t={t} />}
    </>
  );
}
