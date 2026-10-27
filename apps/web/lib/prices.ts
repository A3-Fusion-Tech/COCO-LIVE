import { translator, type Locale } from "./i18n/index.ts";
import { money, when } from "./format.ts";
import type { Catalog, MspItem, PriceItem } from "./api/types.ts";

/** Everything a price card shows, as display text. Meaning is carried by text (freshness, confidence), never colour alone. */
export interface PriceCardView {
  key: string;
  title: string;
  meta: string;
  range: { label: string; value: string }[];
  freshness: PriceItem["freshness"];
  status: string;
  reported: string;
  evidence: string;
  note: string | null;
  /** Query identifying the price bucket, for the evidence page and the alert form. */
  bucket: { productId: string; marketId: string; unit: string; stage: string };
}

export function priceCardView(i: PriceItem, locale: Locale): PriceCardView {
  const t = translator(locale);
  const ta = locale === "ta";
  const ev = i.evidenceSummary;
  const at = when(locale, i.observedWindow.endsAt);
  return {
    key: `${i.product.productId}/${i.market.marketId}/${i.stage}/${i.range.perUnit}/${i.gradeGroup}`,
    title: `${ta ? i.product.nameTa : i.product.name} · ${ta ? i.market.nameTa : i.market.name}`,
    meta: [t(`stage.${i.stage}`), t(`term.${i.tradeTerm}`), i.gradeGroup, t(`unit.${i.range.perUnit}`)].join(" · "),
    range: [
      { label: t("price.low"), value: money(locale, i.range.low.amountPaise) },
      { label: t("price.reference"), value: money(locale, i.range.reference.amountPaise) },
      { label: t("price.high"), value: money(locale, i.range.high.amountPaise) },
    ],
    freshness: i.freshness,
    status: `${t(`price.${i.freshness.toLowerCase()}`)} · ${t(`price.confidence.${i.confidence}`)}`,
    reported: i.freshness === "STALE" ? `${t("price.last_reported")} ${at}` : `${t("price.reported_at")} ${at}`,
    evidence: `${t("price.evidence")}: ${ev.observations} (${ev.independentOrganizations} org · ${ev.officialMarketObservations} official · ${ev.verifiedQuotes} quotes · ${ev.completedTrades} trades)`,
    note: i.messageKey ? t(i.messageKey) : null,
    bucket: { productId: i.product.productId, marketId: i.market.marketId, unit: i.range.perUnit, stage: i.stage },
  };
}

/** One MSP line ("Mature coconut: ₹30 / nut — 2026"); MSP is a policy reference, shown apart from market prices. */
export function mspLine(m: MspItem, locale: Locale, catalog?: Catalog | null): string {
  const t = translator(locale);
  const name = catalog?.products.find((p) => p.productId === m.productId)?.name[locale] ?? m.productId;
  return `${name}: ${money(locale, m.amountPaise)} / ${t(`unit.${m.unit}`)} — ${m.seasonLabel}`;
}
