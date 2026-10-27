import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Empty } from "../../../../_components/ui.tsx";
import { getApi, getNames, getT, load, requireMe } from "../../../../_lib/server.ts";

/** One of the seller's lots with the buy requirements it matches. */
export default async function SellLotPage({ params }: { params: Promise<{ lotId: string }> }) {
  await requireMe();
  const { lotId } = await params;
  const [api, t, names] = await Promise.all([getApi(), getT(), getNames()]);
  const lot = (await load(api.mySellLots())).items.find((l) => l.sellLotId === lotId);
  if (!lot) notFound();
  const matches = await load(api.sellLotMatches(lotId));
  return (
    <>
      <p><Link href="/sell">{`← ${t("common.back")}`}</Link></p>
      <h1>{`${names.product(lot.productId)} — ${lot.quantityTotal} ${lot.unit}`}</h1>
      <Badge t={t} status={lot.status} />
      <h2>{t("sell.matches")}</h2>
      {matches.items.length ? <ul>{matches.items.map((m) => <li key={m.requirementId}>{`${m.requirementId} · ${m.score} · ${m.reasons.join(", ")}`}</li>)}</ul> : <Empty t={t} />}
    </>
  );
}
