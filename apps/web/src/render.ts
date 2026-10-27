import { formatDateTime, formatMoney, t, type Locale } from "@livecoco/localization";

export interface PriceItem {
  kind: string;
  product: { productId: string; name: string; nameTa: string };
  market: { marketId: string; name: string; nameTa: string };
  stage: string; tradeTerm: string; gradeGroup: string;
  range: { low: { amountPaise: number }; reference: { amountPaise: number }; high: { amountPaise: number }; perUnit: string };
  observedWindow: { startsAt: string; endsAt: string };
  freshness: "CURRENT" | "AGING" | "STALE";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  messageKey?: string | null;
  evidenceSummary: { observations: number; independentOrganizations: number; officialMarketObservations: number; verifiedQuotes: number; completedTrades: number };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function renderCard(i: PriceItem, locale: Locale): string {
  const per = t(locale, `unit.${i.range.perUnit}`);
  const fresh = t(locale, `price.${i.freshness.toLowerCase()}`);
  // Essential meaning is conveyed with text (freshness, confidence), never colour alone.
  const note = i.messageKey ? `<p class="note">${esc(t(locale, i.messageKey))}</p>` : "";
  const when = i.freshness === "STALE" ? `${t(locale, "price.last_reported")} ${formatDateTime(i.observedWindow.endsAt, locale)}` : `${t(locale, "price.reported_at")} ${formatDateTime(i.observedWindow.endsAt, locale)}`;
  const ev = i.evidenceSummary;
  return `<article class="card fresh-${i.freshness.toLowerCase()}" aria-label="${esc(locale === "ta" ? i.product.nameTa : i.product.name)}">
  <h2>${esc(locale === "ta" ? i.product.nameTa : i.product.name)} · ${esc(locale === "ta" ? i.market.nameTa : i.market.name)}</h2>
  <p class="meta">${esc(t(locale, `stage.${i.stage}`))} · ${esc(t(locale, `term.${i.tradeTerm}`))} · ${esc(i.gradeGroup)} · ${esc(per)}</p>
  <dl class="range"><div><dt>${t(locale, "price.low")}</dt><dd>${formatMoney(i.range.low.amountPaise, locale)}</dd></div><div><dt>${t(locale, "price.reference")}</dt><dd>${formatMoney(i.range.reference.amountPaise, locale)}</dd></div><div><dt>${t(locale, "price.high")}</dt><dd>${formatMoney(i.range.high.amountPaise, locale)}</dd></div></dl>
  <p><strong>${esc(fresh)}</strong> · ${esc(t(locale, `price.confidence.${i.confidence}`))}</p>
  <p class="meta">${esc(when)}</p>
  <p class="meta">${t(locale, "price.evidence")}: ${ev.observations} (${ev.independentOrganizations} org · ${ev.officialMarketObservations} official · ${ev.verifiedQuotes} quotes · ${ev.completedTrades} trades)</p>
  ${note}
</article>`;
}

export function renderPricesPage(items: PriceItem[], msp: { productId: string; amountPaise: number; unit: string; seasonLabel: string }[], locale: Locale): string {
  const other: Locale = locale === "ta" ? "en" : "ta";
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t(locale, "price.title"))}</title><link rel="manifest" href="/manifest.webmanifest">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:1rem;max-width:48rem;margin-inline:auto;line-height:1.5}
.card{border:1px solid #888;border-radius:.5rem;padding:1rem;margin:.75rem 0}.range{display:flex;gap:1rem;margin:0}.range dt{font-size:.8rem}.range dd{margin:0;font-size:1.25rem;font-weight:700}
.meta{color:#444;font-size:.9rem;margin:.25rem 0}.fresh-stale{border-style:dashed}.note,.disclaimer{background:#fff7d6;padding:.5rem;border-radius:.25rem}
a,button{min-height:44px;display:inline-flex;align-items:center}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}.meta{color:#bbb}.note,.disclaimer{background:#333}}</style></head>
<body><header><h1>${esc(t(locale, "price.title"))}</h1><a href="/?lang=${other}" hreflang="${other}">${other === "ta" ? "தமிழ்" : "English"}</a> · <a href="/app/">${locale === "ta" ? "உள்நுழை / செயலி" : "Sign in / open app"}</a></header>
<p class="disclaimer" role="note">${esc(t(locale, "price.not_offer"))}</p>
<main>${items.length ? items.map((i) => renderCard(i, locale)).join("\n") : `<p>${esc(t(locale, "price.insufficient"))}</p>`}</main>
<aside><h2>MSP</h2><p class="meta">${esc(t(locale, "price.msp_note"))}</p><ul>${msp.map((m) => `<li>${esc(m.productId)}: ${formatMoney(m.amountPaise, locale)} / ${esc(t(locale, `unit.${m.unit}`))} — ${esc(m.seasonLabel)}</li>`).join("")}</ul></aside>
<script>if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js")</script></body></html>`;
}
