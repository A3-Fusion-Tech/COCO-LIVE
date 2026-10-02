"use client";
import { useState, type ReactNode } from "react";
import { ApiError, csv, hoursFromNow, localIso, money, problemOf, toPaise, when, type Catalog, type Json, type Lang, type Me } from "./lib.ts";
import { Form, Kv, Section, Slot, opt, type Field, type Option, type Values } from "./widgets.tsx";

/** What the shell hands every page: session, catalog, API access and navigation. */
export interface Shell {
  lang: Lang; me: Me | null; catalog: Catalog | null;
  t: (k: string) => string;
  api: (method: string, path: string, body?: unknown, opts?: { key?: string }) => Promise<Json>;
  toast: (msg: string, bad?: boolean) => void;
  /** Re-renders the current page from fresh data (the former `render()`). */
  reload: () => void;
  go: (route: string) => void;
  loadMe: () => Promise<void>;
  logout: () => Promise<void>;
}

/** The shell plus formatting and lookup helpers bound to the current language and catalog. */
export function makeCtx(s: Shell) {
  const { t, lang } = s;
  const c = {
    ...s,
    money: (paise: number) => money(lang, paise),
    when: (iso: string) => when(lang, iso),
    /** Runs an action, turning API problems into a toast (and sending 401s to the login page). */
    guard: async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try { return await fn(); } catch (e) {
        const p = problemOf(e);
        s.toast(p.fieldErrors?.length ? `${p.message}: ${p.fieldErrors.map((f) => f.field).join(", ")}` : (p.detail && p.code === "VALIDATION_FAILED" ? p.detail : p.message ?? p.detail ?? t("err.generic")), true);
        if (p.status === 401) s.go("login");
        return undefined;
      }
    },
    pname: (id: string) => s.catalog?.products.find((x) => x.productId === id)?.name[lang] ?? id,
    mname: (id: string) => s.catalog?.markets.find((x) => x.marketId === id)?.name[lang] ?? id,
    badge: (st: string) => <span className="badge">{t(`status.${st}`) === `status.${st}` ? st : t(`status.${st}`)}</span>,
    empty: () => <p className="hint">{t("common.none")}</p>,
    productOpts: (): Option[] => (s.catalog?.products ?? []).map((p) => opt(p.productId, p.name[lang])),
    marketOpts: (): Option[] => (s.catalog?.markets ?? []).map((m) => opt(m.marketId, m.name[lang])),
    unitOpts: (pid: string): Option[] => (s.catalog?.products.find((p) => p.productId === pid)?.units ?? ["NUT", "KG", "QUINTAL", "TONNE"]).map((u) => opt(u, u)),
    requireLogin: () => { if (!s.me) { s.go("login"); return false; } return true; },
    can: (cap: string) => !!s.me?.capabilities.includes(cap),
    /** POSTs and re-renders on success. */
    post: (path: string, body: unknown = {}) => c.guard(async () => { await s.api("POST", path, body); s.reload(); }),
  };
  return c;
}
export type Ctx = ReturnType<typeof makeCtx>;
type Page = (c: Ctx, param?: string) => Promise<ReactNode>;

// ---------- prices ----------
const prices: Page = async (c) => {
  const { t } = c;
  const [latest, msp] = await Promise.all([c.api("GET", "/v1/prices/latest"), c.api("GET", "/v1/prices/msp")]);
  const alerts = c.me ? await c.api("GET", "/v1/alerts") : null;
  return <>
    <h1>{t("prices.title")}</h1>
    <p className="note" role="note">{t("prices.disclaimer")}</p>
    {latest.items.length ? null : <p>{t("prices.none")}</p>}
    <div className="grid">{latest.items.map((i: Json) => <Slot key={`${i.product.productId}/${i.market.marketId}/${i.stage}/${i.range.perUnit}`}>{(setDetail, detail) =>
      <article className="card">
        <h2>{c.pname(i.product.productId)} · {c.lang === "ta" ? i.market.nameTa : i.market.name}</h2>
        <p className="hint">{`${i.stage} · ${i.tradeTerm} · ${i.gradeGroup} · ${i.range.perUnit}`}</p>
        <div className="range">{([["price.low", i.range.low], ["price.reference", i.range.reference], ["price.high", i.range.high]] as const).map(([k, v]) => <div key={k}><span>{t(k) === k ? k : k.split(".")[1]}</span><b>{c.money(v.amountPaise)}</b></div>)}</div>
        <p><span className="badge">{i.freshness}</span><span className="badge">{i.confidence}</span></p>
        <p className="hint">{`${t("prices.reported")}: ${c.when(i.observedWindow.endsAt)}`}</p>
        {i.messageKey ? <p className="note">{i.kind === "OFFICIAL_OBSERVATION_ONLY" ? "Latest official market observation only" : "Evidence is limited / may be stale"}</p> : null}
        <p className="hint">{`${i.evidenceSummary.observations} obs · ${i.evidenceSummary.independentOrganizations} org · ${i.evidenceSummary.officialMarketObservations} official · ${i.evidenceSummary.verifiedQuotes} quotes`}</p>
        <div className="row">
          <button className="secondary" type="button" onClick={() => c.guard(async () => {
            const ev = await c.api("GET", `/v1/prices/evidence?productId=${i.product.productId}&marketId=${i.market.marketId}&unit=${i.range.perUnit}&stage=${i.stage}`);
            setDetail(<pre>{ev.observations.map((o: Json) => `${o.sourceClass} · ${c.when(o.observedAt)} · ${c.money(o.range.low.amountPaise)}–${c.money(o.range.high.amountPaise)}`).join("\n")}</pre>);
          })}>{t("prices.evidence")}</button>
          <button className="secondary" type="button" onClick={() => { if (!c.requireLogin()) return; setDetail(<Form key={Date.now()} fields={[
            { name: "direction", label: t("prices.direction"), type: "select", options: [opt("ABOVE", t("prices.above")), opt("BELOW", t("prices.below"))] },
            { name: "threshold", label: t("prices.threshold"), type: "number", required: true },
            { name: "channel", label: "Channel", type: "select", options: [opt("SMS", "SMS"), opt("WHATSAPP", "WhatsApp"), opt("PUSH", "Push")] },
            { name: "consent", label: t("prices.consent"), type: "checkbox" },
          ]} submit={t("common.save")} onSubmit={(v) => c.guard(async () => {
            await c.api("POST", "/v1/alerts", { productId: i.product.productId, marketId: i.market.marketId, unit: i.range.perUnit, stage: i.stage, direction: v.direction, thresholdPaise: toPaise(v.threshold), channel: v.channel, consent: v.consent });
            c.toast(t("prices.alertSaved")); setDetail(null);
          })} />); }}>{t("prices.alert")}</button>
        </div>
        {detail}
      </article>}</Slot>)}</div>
    <p className="hint">{t("prices.msp")}</p>
    <ul>{msp.items.map((m: Json) => <li key={`${m.productId}/${m.seasonLabel}`}>{`${c.pname(m.productId)}: ${c.money(m.amountPaise)} / ${m.unit} — ${m.seasonLabel}`}</li>)}</ul>
    {alerts ? <Section title={t("prices.myAlerts")}>{alerts.items.length ? alerts.items.map((a: Json) => <div className="row" key={a.alertId}>
      <span>{`${c.pname(a.productId)} ${a.direction} ${a.thresholdPaise ? c.money(a.thresholdPaise) : ""}`}</span>{c.badge(a.status)}
      <button className="secondary" type="button" onClick={() => c.guard(async () => { await c.api("PATCH", `/v1/alerts/${a.alertId}`, { status: a.status === "PAUSED" ? "ACTIVE" : "PAUSED" }); c.reload(); })}>{a.status === "PAUSED" ? t("prices.resume") : t("prices.pause")}</button>
      <button className="danger" type="button" onClick={() => c.guard(async () => { await c.api("PATCH", `/v1/alerts/${a.alertId}`, { status: "CANCELLED" }); c.reload(); })}>{t("prices.cancel")}</button>
    </div>) : c.empty()}</Section> : null}
  </>;
};

// ---------- sign in ----------
const login: Page = async (c) => {
  const { t } = c;
  return <>
    <h1>{t("login.title")}</h1>
    <Slot>{(setCode, codeBox) => <>
      <Form fields={[{ name: "phone", label: t("login.phone"), type: "tel", required: true, hint: "+91 …" }]} submit={t("login.send")} onSubmit={(v) => c.guard(async () => {
        await c.api("POST", "/v1/auth/otp/request", { phone: v.phone });
        c.toast(t("login.sent"));
        setCode(<Form key={Date.now()} fields={[{ name: "code", label: t("login.code"), type: "text", mode: "numeric", required: true }]} submit={t("login.verify")} onSubmit={(cv) => c.guard(async () => {
          const r = await fetch("/session/verify", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "livecoco" }, body: JSON.stringify({ phone: v.phone, code: cv.code }) });
          if (!r.ok) throw new ApiError({ ...(await r.json().catch(() => ({}))), status: r.status });
          await c.loadMe(); c.go("prices");
        })} />);
      })} />
      <div>{codeBox}</div>
    </>}</Slot>
  </>;
};

// ---------- account ----------
const CLAIM_TYPES = ["PERSON_IDENTITY", "ORGANIZATION_EXISTENCE", "BUSINESS_DOCUMENT", "GST_DOCUMENT", "FSSAI_DOCUMENT", "PRICE_CONTRIBUTOR_SCOPE"];
const ORG_KINDS = ["FPO", "FARMER_GROUP", "TRADER", "PROCESSOR", "BUYER", "INSPECTION_PARTNER", "LOGISTICS_PARTNER"];
const account: Page = async (c) => {
  if (!c.requireLogin()) return null;
  const { t } = c;
  const me = c.me as Me;
  const orgs = await c.api("GET", "/v1/me/organizations");
  return <>
    <h1>{t("me.title")}</h1>
    <Section title={t("me.title")}><Form fields={[
      { name: "displayName", label: t("me.name"), value: me.displayName },
      { name: "actingAs", label: t("me.acting"), type: "select", value: me.actingAs, options: [opt("INDEPENDENT", t("me.independent")), opt("ORGANIZATION", t("me.organization"))] },
      { name: "locale", label: t("me.language"), type: "select", value: me.locale, options: [opt("ta", "தமிழ்"), opt("en", "English")] },
    ]} submit={t("common.save")} onSubmit={(v) => c.guard(async () => { await c.api("PATCH", "/v1/me", v); c.toast(t("me.saved")); await c.loadMe(); })} /></Section>
    <Section title={t("me.claims")}>
      {me.claims.length ? <ul>{me.claims.map((cl, n) => <li key={n}>{`${cl.type} — ${cl.status}`}</li>)}</ul> : <p className="hint">{t("me.claimNone")}</p>}
      <Form fields={[
        { name: "type", label: t("me.claimType"), type: "select", options: CLAIM_TYPES.map((x) => opt(x, x)) },
        { name: "evidence", label: t("me.claimEvidence"), required: true },
        { name: "marketId", label: "Market (contributors)", type: "select", options: [opt("", "—"), ...c.marketOpts()] },
        { name: "productId", label: "Product (contributors)", type: "select", options: [opt("", "—"), ...c.productOpts()] },
      ]} submit={t("me.claimSubmit")} onSubmit={(v) => c.guard(async () => {
        const scope: Record<string, string> = {};
        if (v.marketId) scope.marketId = v.marketId;
        if (v.productId) scope.productId = v.productId;
        await c.api("POST", "/v1/claims", { type: v.type, scope, evidence: [v.evidence] });
        c.toast(t("me.claimSubmitted"));
      })} />
    </Section>
    <Section title={t("nav.org")}>
      {orgs.items.length ? <ul>{orgs.items.map((o: Json) => <li key={o.organizationId}>{`${o.name} — ${o.kind} (${o.role})`}</li>)}</ul> : c.empty()}
      <Form fields={[{ name: "name", label: t("me.orgName"), required: true }, { name: "kind", label: t("me.orgKind"), type: "select", options: ORG_KINDS.map((k) => opt(k, k)) }]} submit={t("me.orgCreate")} onSubmit={(v) => c.guard(async () => { await c.api("POST", "/v1/organizations", v); c.reload(); })} />
    </Section>
    <button className="secondary" type="button" onClick={() => c.logout()}>{t("common.logout")}</button>
  </>;
};

// ---------- sell ----------
const lotFields = (t: Ctx["t"], pid: string): Field[] => ({
  prod_mature_coconut: [{ name: "husk", label: t("sell.husk"), value: "WITH_HUSK" }],
  prod_tender_coconut: [{ name: "size", label: t("sell.size"), value: "MEDIUM" }],
  prod_milling_copra: [{ name: "moisturePercent", label: t("sell.moisture"), value: "6" }],
  prod_ball_copra: [{ name: "moisturePercent", label: t("sell.moisture"), value: "7" }],
} as Record<string, Field[]>)[pid] ?? [];

/** New-lot form; changing the product rebuilds the form with that product's quality fields. */
function LotForm({ c }: { c: Ctx }) {
  const { t } = c;
  const [pid, setPid] = useState("prod_mature_coconut");
  return <Form key={pid} fields={[
    { name: "productId", label: t("sell.product"), type: "select", value: pid, options: c.productOpts(), onChange: setPid },
    ...lotFields(t, pid),
    { name: "unit", label: t("sell.unit"), type: "select", options: c.unitOpts(pid) },
    { name: "quantity", label: t("sell.quantity"), type: "text", mode: "decimal", required: true },
    { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" },
    { name: "origin", label: t("sell.origin"), type: "select", options: c.marketOpts() },
    { name: "price", label: t("sell.price"), type: "number" },
    { name: "from", label: t("sell.from"), type: "datetime-local", required: true },
    { name: "to", label: t("sell.to"), type: "datetime-local", required: true },
    { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true },
    { name: "mode", label: `${t("sell.pickup")} / ${t("sell.delivery")}`, type: "select", options: [opt("PICKUP", t("sell.pickup")), opt("DELIVERY", t("sell.delivery"))] },
    { name: "costsIn", label: t("sell.costsIn"), value: "LOADING" },
    { name: "costsEx", label: t("sell.costsEx"), value: "TRANSPORT" },
    { name: "partial", label: t("sell.partial"), type: "checkbox", value: true },
    { name: "onBehalf", label: t("sell.listedFor") },
  ]} submit={t("common.create")} onSubmit={(v) => c.guard(async () => {
    const attrs = Object.fromEntries(lotFields(t, v.productId).map((f) => [f.name, v[f.name]]));
    await c.api("POST", "/v1/sell-lots", { productId: v.productId, gradeAttributes: attrs, gradeGroup: v.gradeGroup, unit: v.unit, quantityTotal: v.quantity, partialFulfilmentAllowed: v.partial, originMarketId: v.origin, availableFrom: localIso(v.from), availableTo: localIso(v.to), expiresAt: localIso(v.expires), fulfilment: { mode: v.mode, costsIncluded: csv(v.costsIn), costsExcluded: csv(v.costsEx) }, priceExpectation: v.price ? { unitPricePaise: toPaise(v.price) } : { inviteOffers: true }, ...(v.onBehalf ? { listedOnBehalfOf: v.onBehalf } : {}) });
    c.reload();
  })} />;
}

/** Signed upload: ask the API for an upload intent, then PUT the file to the (same-origin) signed URL. */
async function uploadPhoto(c: Ctx, file: File | undefined, lotId: string) {
  if (!file) return;
  await c.guard(async () => {
    const intent = await c.api("POST", "/v1/uploads/intents", { purpose: "LOT_PHOTO", contentType: file.type, sizeBytes: file.size, refId: lotId });
    const u = new URL(intent.uploadUrl, location.origin);
    const r = await fetch(u.pathname + u.search, { method: "PUT", body: file });
    if (!r.ok) throw new ApiError({ ...(await r.json().catch(() => ({}))), status: r.status });
    c.toast(c.t("sell.photoOk"));
  });
}

const sell: Page = async (c) => {
  if (!c.requireLogin()) return null;
  const { t } = c;
  const mine = await c.api("GET", "/v1/me/sell-lots");
  return <>
    <h1>{t("sell.title")}</h1>
    <Section title={t("sell.new")}><div><LotForm c={c} /></div></Section>
    <h2>{t("sell.mine")}</h2>
    {mine.items.length ? <div>{mine.items.map((l: Json) => <Slot key={l.sellLotId}>{(setExtra, extra) => <div className="card">
      <h2>{`${c.pname(l.productId)} — ${l.quantityTotal} ${l.unit}`}</h2>{c.badge(l.status)}
      <p className="hint">{`${c.mname(l.originMarketId)} · ${t("offers.expires")} ${c.when(l.expiresAt)} · reserved ${l.quantityReserved} · 📷 ${l.photoCount}`}</p>
      <div className="row">
        <label className="btn secondary pick">{t("sell.photo")}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="visually-hidden" onChange={(e) => uploadPhoto(c, e.target.files?.[0], l.sellLotId)} /></label>
        {l.status === "DRAFT" ? <button type="button" onClick={() => c.post(`/v1/sell-lots/${l.sellLotId}/activate`)}>{t("sell.activate")}</button> : null}
        {["DRAFT", "ACTIVE", "PENDING_REVIEW"].includes(l.status) ? <button className="danger" type="button" onClick={() => c.post(`/v1/sell-lots/${l.sellLotId}/withdraw`)}>{t("sell.withdraw")}</button> : null}
        <button className="secondary" type="button" onClick={() => c.guard(async () => {
          const m = await c.api("GET", `/v1/sell-lots/${l.sellLotId}/matches`);
          setExtra(<><h3>{t("sell.matches")}</h3>{m.items.length ? m.items.map((x: Json) => <p key={x.requirementId}>{`${x.requirementId} · ${x.score} · ${x.reasons.join(", ")}`}</p>) : c.empty()}</>);
        })}>{t("sell.matches")}</button>
      </div>
      <div>{extra}</div>
    </div>}</Slot>)}</div> : c.empty()}
  </>;
};

// ---------- market ----------
const market: Page = async (c) => {
  const { t } = c;
  const lots = await c.api("GET", "/v1/sell-lots");
  return <>
    <h1>{t("market.title")}</h1>
    {lots.items.length ? null : <p>{t("common.none")}</p>}
    {lots.items.map((l: Json) => <Slot key={l.sellLotId}>{(setBox, box) => <article className="card">
      <h2>{`${c.pname(l.productId)} — ${l.quantityAvailable} ${l.unit} ${t("sell.available")}`}</h2>
      <p className="hint">{`${c.mname(l.originMarketId)} · ${l.gradeGroup} · ${l.fulfilment.mode} · ${l.priceExpectation.unitPricePaise ? c.money(l.priceExpectation.unitPricePaise) : "—"}`}</p>
      <p className="hint">{l.verificationClaims.map((x: Json) => x.type).join(", ") || "—"}</p>
      <button type="button" onClick={() => { if (!c.requireLogin()) return; setBox(<Form key={Date.now()} fields={[
        { name: "qty", label: t("market.qty"), type: "text", mode: "decimal", value: String(l.quantityAvailable), required: true },
        { name: "price", label: t("market.unitPrice"), type: "number", required: true },
        { name: "hours", label: t("market.validHours"), type: "number", value: "24" },
        { name: "payment", label: t("market.payment"), type: "select", options: ["UPI", "CASH", "BANK_TRANSFER"].map((x) => opt(x, x)) },
        { name: "due", label: t("market.paymentDue"), type: "select", options: ["ON_LOADING", "ON_DELIVERY", "WITHIN_3_DAYS", "WITHIN_7_DAYS"].map((x) => opt(x, x)) },
        { name: "weigh", label: t("market.weighment"), type: "select", options: ["COUNT", "SCALE", "WEIGHBRIDGE"].map((x) => opt(x, x)) },
      ]} submit={t("market.offer")} onSubmit={(v) => c.guard(async () => {
        await c.api("POST", "/v1/offers", { sellLotId: l.sellLotId, expiresAt: hoursFromNow(Number(v.hours)), terms: { quantity: v.qty, unit: l.unit, unitPricePaise: toPaise(v.price), gradeGroup: l.gradeGroup, fulfilmentMode: l.fulfilment.mode, costsIncluded: l.fulfilment.costsIncluded, costsExcluded: l.fulfilment.costsExcluded, weighmentMethod: v.weigh, weighmentLocation: c.mname(l.originMarketId), paymentMethod: v.payment, paymentDue: v.due, fulfilmentFrom: l.availableFrom, fulfilmentBy: l.availableTo, acceptanceWindowHours: 24, inspectionTerms: "Buyer may inspect at loading" } });
        c.toast(t("market.sent")); setBox(null); c.go("deals");
      })} />); }}>{t("market.offer")}</button>
      <div>{box}</div>
    </article>}</Slot>)}
  </>;
};

// ---------- buy ----------
const buy: Page = async (c) => {
  if (!c.requireLogin()) return null;
  const { t } = c;
  const verified = (c.me as Me).claims.some((x) => ["PERSON_IDENTITY", "ORGANIZATION_EXISTENCE"].includes(x.type));
  const mine = await c.api("GET", "/v1/me/buy-requirements");
  return <>
    <h1>{t("buy.title")}</h1>
    {verified ? null : <p className="note">{t("buy.verifyFirst")}</p>}
    <Section title={t("buy.new")}><Form fields={[
      { name: "productId", label: t("sell.product"), type: "select", options: c.productOpts() },
      { name: "unit", label: t("sell.unit"), type: "select", options: c.unitOpts("prod_mature_coconut") },
      { name: "target", label: t("buy.target"), mode: "decimal", required: true }, { name: "min", label: t("buy.min"), mode: "decimal" },
      { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" },
      { name: "dest", label: t("buy.dest"), type: "select", options: c.marketOpts() }, { name: "radius", label: t("buy.radius"), type: "number", value: "40" },
      { name: "from", label: t("sell.from"), type: "datetime-local", required: true }, { name: "by", label: t("buy.by"), type: "datetime-local", required: true }, { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true },
      { name: "maxPrice", label: t("buy.maxPrice"), type: "number" },
      { name: "repeat", label: t("buy.recurring"), type: "select", options: [opt("", t("buy.once")), opt("WEEKLY", "WEEKLY"), opt("FORTNIGHTLY", "FORTNIGHTLY"), opt("MONTHLY", "MONTHLY")] },
      { name: "times", label: "Occurrences", type: "number", value: "4" },
      { name: "partial", label: t("sell.partial"), type: "checkbox", value: true },
    ]} submit={t("common.create")} onSubmit={(v: Values) => c.guard(async () => {
      const body = { productId: v.productId, gradeGroup: v.gradeGroup, unit: v.unit, targetQuantity: v.target, minQuantity: v.min || v.target, partialAllowed: v.partial, destinationMarketId: v.dest, maxRadiusKm: Number(v.radius), requiredFrom: localIso(v.from), requiredBy: localIso(v.by), expiresAt: localIso(v.expires), ...(v.maxPrice ? { maxUnitPricePaise: toPaise(v.maxPrice) } : {}) };
      if (v.repeat) await c.api("POST", "/v1/buy-requirements/recurring", { ...body, cadence: v.repeat, occurrences: Number(v.times) });
      else await c.api("POST", "/v1/buy-requirements", body);
      c.reload();
    })} /></Section>
    {mine.items.map((r: Json) => <Slot key={r.requirementId}>{(setExtra, extra) => <div className="card">
      <h2>{`${c.pname(r.productId)} — ${r.targetQuantity} ${r.unit}`}</h2>{c.badge(r.status)}
      <p className="hint">{`${c.mname(r.destination.marketId)} · ${c.when(r.requiredBy)}`}</p>
      <div className="row">
        <button className="secondary" type="button" onClick={() => c.guard(async () => {
          const m = await c.api("GET", `/v1/buy-requirements/${r.requirementId}/matches`);
          setExtra(<><h3>{t("buy.matches")}</h3>{m.items.length ? m.items.map((x: Json) => <p key={x.sellLotId}>{`${x.sellLotId} · ${x.score} · ${x.reasons.join(", ")}`}</p>) : c.empty()}</>);
        })}>{t("buy.matches")}</button>
        {["ACTIVE", "DRAFT"].includes(r.status) ? <button className="danger" type="button" onClick={() => c.post(`/v1/buy-requirements/${r.requirementId}/close`)}>{t("buy.close")}</button> : null}
      </div>
      <div>{extra}</div>
    </div>}</Slot>)}
  </>;
};

// ---------- offers and deals ----------
const deals: Page = async (c, param) => {
  if (!c.requireLogin()) return null;
  if (param) return dealDetail(c, param);
  const { t } = c;
  const me = c.me as Me;
  const [offers, list] = [await c.api("GET", "/v1/offers"), await c.api("GET", "/v1/deals")];
  return <>
    <h1>{t("offers.title")}</h1>
    {offers.items.length ? null : c.empty()}
    {offers.items.map((o: Json) => {
      const mineOffer = o.createdByPartyId === me.userId;
      return <Slot key={o.offerId}>{(setBox, box) => <div className="card">
        <h2>{`${o.terms.quantity} ${o.terms.unit} @ ${c.money(o.terms.unitPricePaise)}`}</h2>{c.badge(o.status)}
        <p className="hint">{`${t("offers.revision")} ${o.revision} · ${t("offers.expires")} ${c.when(o.expiresAt)} · ${t("offers.total")} ${c.money(o.estimatedTotalPaise)}`}</p>
        {o.status === "ACTIVE" ? <div className="row">
          {!mineOffer ? <>
            <button type="button" onClick={() => c.guard(async () => { const d = await c.api("POST", `/v1/offers/${o.offerId}/accept`, {}, { key: `accept-${o.offerId}` }); c.toast(t("offers.accepted")); c.go(`deals/${d.dealId}`); })}>{t("offers.accept")}</button>
            <button className="danger" type="button" onClick={() => c.post(`/v1/offers/${o.offerId}/reject`)}>{t("offers.reject")}</button>
            <button className="secondary" type="button" onClick={() => setBox(<Form key={Date.now()} fields={[{ name: "price", label: t("market.unitPrice"), type: "number", required: true }, { name: "hours", label: t("market.validHours"), type: "number", value: "24" }]} submit={t("offers.counter")}
              onSubmit={(v) => c.guard(async () => { await c.api("POST", `/v1/offers/${o.offerId}/counter`, { terms: { ...o.terms, unitPricePaise: toPaise(v.price) }, expiresAt: hoursFromNow(Number(v.hours)) }); c.reload(); })} />)}>{t("offers.counter")}</button>
          </> : null}
          {mineOffer ? <button className="danger" type="button" onClick={() => c.post(`/v1/offers/${o.offerId}/withdraw`)}>{t("offers.withdraw")}</button> : null}
        </div> : null}
        <div>{box}</div>
      </div>}</Slot>;
    })}
    <h1>{t("deals.title")}</h1>
    {list.items.length ? list.items.map((d: Json) => { const last = d.cards.at(-1); return <a key={d.dealId} className="card linkcard" href={`#/deals/${d.dealId}`}><b>{`${last.terms.quantity} ${last.terms.unit} @ ${c.money(last.terms.unitPricePaise)}`}</b> {c.badge(d.status)}</a>; }) : c.empty()}
  </>;
};

const DISPUTE_REASONS = ["QUANTITY_VARIANCE", "QUALITY_MISMATCH", "DAMAGE", "DELIVERY_FAILURE", "UNDISCLOSED_DEDUCTION", "NON_PAYMENT", "NO_SHOW"];
async function dealDetail(c: Ctx, id: string): Promise<ReactNode> {
  const { t } = c;
  const d = await c.api("GET", `/v1/deals/${id}`);
  const card = d.cards.at(-1);
  const me = (c.me as Me).userId;
  const seller = d.sellerId === me, buyer = d.buyerId === me;
  const s: string = d.status;
  const act = (label: string, path: string, body: unknown = {}, cls = "") => <button key={path} type="button" className={cls} onClick={() => c.post(`/v1/deals/${id}/${path}`, body)}>{label}</button>;
  const partners = s === "AGREED" ? await c.api("GET", "/v1/partners?kind=INSPECTION") : { items: [] };
  const insp = await c.api("GET", `/v1/deals/${id}/inspections`).catch(() => ({ items: [] }));
  const dis = d.disputeId ? await c.api("GET", `/v1/disputes/${d.disputeId}`).catch(() => null) : null;
  return <>
    <p><a href="#/deals">{`← ${t("common.back")}`}</a></p>
    <h1>{t("deals.title")}</h1>
    {c.badge(s)}
    <p className="note">{t("deals.noGuarantee")}</p>
    <Section title={`${t("deals.card")} #${card.revision}`}><Kv obj={{ [t("sell.quantity")]: `${card.terms.quantity} ${card.terms.unit}`, [t("market.unitPrice")]: c.money(card.terms.unitPricePaise), [t("offers.total")]: c.money(card.totalPaise), [t("market.payment")]: `${card.terms.paymentMethod} / ${card.terms.paymentDue}`, [t("market.weighment")]: card.terms.weighmentMethod, [t("sell.costsIn")]: card.terms.costsIncluded.join(", "), [t("sell.costsEx")]: card.terms.costsExcluded.join(", ") }} /></Section>
    <div className="card"><div className="row">
      {s === "AGREED" ? act(t("deals.pickup"), "pickup") : null}
      {seller && ["AGREED", "PICKUP_CONFIRMED"].includes(s) ? <Form fields={[{ name: "actualQuantity", label: t("deals.actualQty"), mode: "decimal", value: card.terms.quantity }]} submit={t("deals.deliver")} onSubmit={(v) => c.post(`/v1/deals/${id}/delivery`, { actualQuantity: v.actualQuantity })} /> : null}
      {buyer && s === "DELIVERED" ? act(t("deals.acceptDelivery"), "accept") : null}
      {seller && s === "ACCEPTED" ? act(t("deals.payment"), "payment", { method: card.terms.paymentMethod }) : null}
      {s === "PAYMENT_CONFIRMED" ? act(t("deals.complete"), "complete") : null}
      {["AGREED", "PICKUP_CONFIRMED", "INSPECTION_PENDING"].includes(s) ? <Form fields={[{ name: "reason", label: t("common.reason"), required: true }]} submit={t("deals.cancel")} danger onSubmit={(v) => c.post(`/v1/deals/${id}/cancel`, { reason: v.reason })} /> : null}
    </div></div>
    {d.pendingAmendment ? <Section title={t("deals.respondAmend")}>
      <Kv obj={{ proposedBy: d.pendingAmendment.proposedBy, ...d.pendingAmendment.terms }} />
      {d.pendingAmendment.proposedBy !== me ? <div className="row">
        <button type="button" onClick={() => c.post(`/v1/deals/${id}/amendments/respond`, { accept: true })}>{t("common.yes")}</button>
        <button className="danger" type="button" onClick={() => c.post(`/v1/deals/${id}/amendments/respond`, { accept: false })}>{t("common.no")}</button>
      </div> : null}
    </Section> : !["COMPLETED", "CANCELLED", "DISPUTED"].includes(s) ? <Section title={t("deals.amend")}>
      <Form fields={[{ name: "qty", label: t("sell.quantity"), value: card.terms.quantity, mode: "decimal" }, { name: "price", label: t("market.unitPrice"), type: "number", value: String(card.terms.unitPricePaise / 100) }]} submit={t("deals.amend")}
        onSubmit={(v) => c.guard(async () => { await c.api("POST", `/v1/deals/${id}/amendments`, { terms: { ...card.terms, quantity: v.qty, unitPricePaise: toPaise(v.price) } }); c.reload(); })} />
    </Section> : null}
    {partners.items.length ? <Section title={t("deals.inspection")}>
      <Form fields={[{ name: "partnerId", label: t("deals.partner"), type: "select", options: partners.items.map((p: Json) => opt(p.partnerId, p.name)) }, { name: "at", label: t("deals.scheduled"), type: "datetime-local", required: true }, { name: "loc", label: t("deals.location"), required: true }]} submit={t("deals.inspection")}
        onSubmit={(v) => c.guard(async () => { await c.api("POST", `/v1/deals/${id}/inspections`, { partnerId: v.partnerId, scheduledAt: localIso(v.at), location: v.loc }); c.reload(); })} />
    </Section> : null}
    {insp.items.map((i: Json) => <Section key={i.inspectionId} title={`${t("deals.inspection")}: ${i.status}`}>
      {i.result ? <Kv obj={{ outcome: i.result.outcome, ...i.result.measurements, note: i.result.note }} /> : null}
      {buyer && i.status === "COMPLETED" ? <div className="row">
        <button type="button" onClick={() => c.post(`/v1/inspections/${i.inspectionId}/decision`, { accept: true })}>{t("offers.accept")}</button>
        <button className="danger" type="button" onClick={() => c.post(`/v1/inspections/${i.inspectionId}/decision`, { accept: false })}>{t("offers.reject")}</button>
      </div> : null}
    </Section>)}
    {!["COMPLETED", "CANCELLED"].includes(s) ? <Slot>{(setDrop, drop) => <Section title={t("deals.transport")}>
      <Form fields={[{ name: "dest", label: t("deals.destination"), type: "select", options: c.marketOpts() }, { name: "kg", label: t("deals.weight"), type: "number", required: true }, { name: "from", label: t("deals.window"), type: "datetime-local", required: true }, { name: "to", label: "→", type: "datetime-local", required: true }]} submit={t("deals.transport")} onSubmit={(v) => c.guard(async () => {
        const r = await c.api("POST", `/v1/deals/${id}/transport-requests`, { destinationMarketId: v.dest, weightKg: Number(v.kg), windowFrom: localIso(v.from), windowTo: localIso(v.to) });
        const q = await c.api("GET", `/v1/transport-requests/${r.requestId}/quotes`);
        setDrop(q.items.length ? q.items.map((x: Json) => <p key={x.quoteId}>{`${c.money(x.pricePaise)} · ${x.vehicleType}`}<button type="button" onClick={() => c.post(`/v1/transport-quotes/${x.quoteId}/book`, { vehicle: { registration: "TBD", driverPhone: "TBD" } })}>{t("common.open")}</button></p>) : <p className="hint">{`${r.requestId}`}</p>);
      })} />
      <div>{drop}</div>
    </Section>}</Slot> : null}
    {["DELIVERED", "ACCEPTED", "PAYMENT_CONFIRMED", "AGREED", "PICKUP_CONFIRMED"].includes(s) && !d.disputeId ? <Section title={t("deals.dispute")}>
      <Form fields={[{ name: "reason", label: t("deals.disputeReason"), type: "select", options: DISPUTE_REASONS.map((x) => opt(x, x)) }, { name: "qty", label: t("sell.quantity"), mode: "decimal" }, { name: "amount", label: "₹", type: "number" }]} submit={t("deals.dispute")} danger
        onSubmit={(v) => c.guard(async () => { await c.api("POST", `/v1/deals/${id}/disputes`, { reason: v.reason, ...(v.qty ? { claimedQuantity: v.qty } : {}), ...(v.amount ? { claimedAmountPaise: toPaise(v.amount) } : {}) }); c.reload(); })} />
    </Section> : null}
    {dis ? <Section title={`${t("deals.dispute")}: ${dis.status}`}>
      <Kv obj={{ reason: dis.reason, due: c.when(dis.responseDueAt), ...(dis.resolution ? { outcome: dis.resolution.outcome, why: dis.resolution.reason } : {}) }} />
      {dis.respondent === me && !dis.response ? <Form fields={[{ name: "text", label: t("deals.evidence"), type: "textarea", required: true }]} submit={t("common.submit")} onSubmit={(v) => c.post(`/v1/disputes/${d.disputeId}/response`, { text: v.text })} /> : null}
    </Section> : null}
    <Section title={t("deals.evidence")}><Form fields={[{ name: "note", label: t("deals.evidence"), required: true }]} submit={t("common.save")} onSubmit={(v) => c.post(`/v1/deals/${id}/evidence`, { kind: "NOTE", note: v.note })} /></Section>
    <Section title={t("deals.timeline")}><ol className="timeline">{d.events.map((e: Json, n: number) => <li key={n}>{`${c.when(e.at)} — ${e.type}`}</li>)}</ol></Section>
  </>;
}

// ---------- FPO aggregation and settlement ----------
const org: Page = async (c) => {
  if (!c.requireLogin()) return null;
  const { t } = c;
  const me = c.me as Me;
  const orgs = (await c.api("GET", "/v1/me/organizations")).items.filter((o: Json) => ["FPO", "FARMER_GROUP"].includes(o.kind));
  if (!orgs.length) return <><h1>{t("org.title")}</h1>{c.empty()}</>;
  const boxes: ReactNode[] = [];
  for (const o of orgs) {
    const members = (await c.api("GET", `/v1/organizations/${o.organizationId}/member-lots`)).items;
    const settleable = (await c.api("GET", "/v1/deals")).items.filter((d: Json) => ["ACCEPTED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(d.status) && d.sellerId === me.userId);
    const selected = new Set<string>();
    boxes.push(<div className="card" key={o.organizationId}>
      <h2>{`${o.name} (${o.role})`}</h2>
      <Form fields={[{ name: "memberName", label: t("org.memberName"), required: true }, { name: "productId", label: t("sell.product"), type: "select", options: c.productOpts() }, { name: "unit", label: t("sell.unit"), type: "select", options: c.unitOpts("prod_mature_coconut") }, { name: "quantity", label: t("sell.quantity"), mode: "decimal", required: true }, { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" }, { name: "origin", label: t("sell.origin"), type: "select", options: c.marketOpts() }, { name: "husk", label: t("sell.husk"), value: "WITH_HUSK" }]}
        submit={t("org.addMember")} onSubmit={(v) => c.post(`/v1/organizations/${o.organizationId}/member-lots`, { memberName: v.memberName, productId: v.productId, gradeGroup: v.gradeGroup, unit: v.unit, quantity: v.quantity, originMarketId: v.origin, quality: { husk: v.husk } })} />
      <h3>{t("org.members")}</h3>
      {members.length ? <table><tbody>{members.map((m: Json) => <tr key={m.memberLotId}>
        <td>{m.status === "APPROVED" ? <input type="checkbox" aria-label={m.memberName} onChange={(e) => (e.target.checked ? selected.add(m.memberLotId) : selected.delete(m.memberLotId))} /> : null}</td>
        <td>{`${m.memberName} — ${m.quantity} ${m.unit}`}</td>
        <td>{c.badge(m.status)}</td>
        <td>{m.status === "PENDING_REVIEW" ? <div className="row">
          <button type="button" onClick={() => c.post(`/v1/member-lots/${m.memberLotId}/review`, { approve: true })}>{t("org.review")}</button>
          <button className="danger" type="button" onClick={() => c.post(`/v1/member-lots/${m.memberLotId}/review`, { approve: false })}>{t("org.reject")}</button>
        </div> : null}</td>
      </tr>)}</tbody></table> : c.empty()}
      <h3>{t("org.aggregate")}</h3>
      <Form fields={[{ name: "from", label: t("sell.from"), type: "datetime-local", required: true }, { name: "to", label: t("sell.to"), type: "datetime-local", required: true }, { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true }, { name: "tol", label: "Tolerance %", type: "number", value: "2" }]}
        submit={t("org.aggregate")} onSubmit={(v) => c.guard(async () => { await c.api("POST", `/v1/organizations/${o.organizationId}/aggregates`, { memberLotIds: [...selected], tolerancePercent: Number(v.tol), availableFrom: localIso(v.from), availableTo: localIso(v.to), expiresAt: localIso(v.expires), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } }); c.reload(); })} />
      <h3>{t("org.settlements")}</h3>
      {settleable.length ? settleable.map((d: Json) => <div className="card" key={d.dealId}><b>{d.dealId}</b>
        <Form fields={[{ name: "ded", label: t("deals.deductions"), hint: "TRANSPORT:1500, COMMISSION:500" }]} submit={t("deals.settlement")} onSubmit={(v) => c.guard(async () => {
          const deductions = csv(v.ded).map((x) => { const [type = "", amt = ""] = x.split(":"); return { type: type.trim(), amountPaise: toPaise(amt) }; });
          const st = await c.api("POST", `/v1/deals/${d.dealId}/settlement`, { deductions });
          c.toast(`${t("deals.settlement")}: ${c.money(st.netPaise)}`); c.reload();
        })} />
      </div>) : c.empty()}
    </div>);
  }
  return <><h1>{t("org.title")}</h1>{boxes}</>;
};

// ---------- partner workspace ----------
const NEXT_TRANSPORT_STATUS: Record<string, string> = { BOOKED: "PICKED_UP", PICKED_UP: "IN_TRANSIT", IN_TRANSIT: "DELIVERED" };
const partner: Page = async (c) => {
  if (!c.requireLogin()) return null;
  const { t } = c;
  const orgs = (await c.api("GET", "/v1/me/organizations")).items.filter((o: Json) => o.kind.endsWith("_PARTNER"));
  const mine = (await c.api("GET", "/v1/me/partners")).items;
  const unapplied = orgs.filter((o: Json) => !mine.some((p: Json) => p.organizationId === o.organizationId));
  const out: ReactNode[] = [];
  for (const p of mine) {
    out.push(<div className="card" key={p.partnerId}><b>{`${p.kind} — ${p.partnerId}`}</b> {c.badge(p.status)}</div>);
    if (p.status !== "APPROVED") continue;
    const sla = await c.api("GET", `/v1/partners/${p.partnerId}/sla`);
    out.push(<Section key={`${p.partnerId}/sla`} title={t("partner.sla")}><Kv obj={{ inspections: sla.inspections, transport: sla.transport }} /></Section>);
    if (p.kind === "INSPECTION") {
      const jobs = (await c.api("GET", "/v1/partner/inspections")).items;
      out.push(<h2 key={`${p.partnerId}/ih`}>{t("partner.inspections")}</h2>, jobs.length ? jobs.map((i: Json) => <div className="card" key={i.inspectionId}>
        <b>{`${i.location} — ${c.when(i.scheduledAt)}`}</b> {c.badge(i.status)}
        {i.status === "REQUESTED" ? <button type="button" onClick={() => c.post(`/v1/inspections/${i.inspectionId}/accept`)}>{t("partner.accept")}</button> : null}
        {i.status === "SCHEDULED" ? <Form fields={[{ name: "outcome", label: t("partner.outcome"), type: "select", options: ["PASS", "FAIL", "CONDITIONAL"].map((x) => opt(x, x)) }, { name: "m", label: t("partner.measure"), value: "sampleSize:100" }, { name: "note", label: t("partner.note"), required: true }]} submit={t("partner.result")}
          onSubmit={(v) => c.post(`/v1/inspections/${i.inspectionId}/result`, { outcome: v.outcome, measurements: Object.fromEntries(csv(v.m).map((x) => { const [k = "", n] = x.split(":"); return [k.trim(), Number(n)]; })), note: v.note })} /> : null}
      </div>) : <div key={`${p.partnerId}/ie`}>{c.empty()}</div>);
    } else {
      const open = (await c.api("GET", "/v1/partner/transport-requests")).items;
      out.push(<h2 key={`${p.partnerId}/oh`}>{t("partner.open")}</h2>, open.length ? open.map((r: Json) => <div className="card" key={r.requestId}>
        <b>{`${c.mname(r.pickupMarketId)} → ${c.mname(r.destinationMarketId)} · ${r.weightKg} kg`}</b>
        <Form fields={[{ name: "price", label: t("partner.price"), type: "number", required: true }, { name: "vehicle", label: t("partner.vehicle"), value: "LCV" }, { name: "eta", label: "ETA", type: "datetime-local", required: true }]} submit={t("partner.quote")}
          onSubmit={(v) => c.guard(async () => { await c.api("POST", `/v1/transport-requests/${r.requestId}/quotes`, { pricePaise: toPaise(v.price), vehicleType: v.vehicle, etaFrom: localIso(v.eta), etaTo: localIso(v.eta), validUntil: hoursFromNow(24) }); c.reload(); })} />
      </div>) : <div key={`${p.partnerId}/oe`}>{c.empty()}</div>);
      const jobs = (await c.api("GET", "/v1/partner/transport-jobs")).items;
      for (const j of jobs.filter((x: Json) => x.status !== "DELIVERED")) {
        const next = NEXT_TRANSPORT_STATUS[j.status];
        out.push(<div className="card" key={`job/${j.requestId}`}><b>{`${j.requestId} — ${j.status}`}</b>{next ? <button type="button" onClick={() => c.post(`/v1/transport-requests/${j.requestId}/status`, { status: next })}>{`${t("partner.status")}: ${next}`}</button> : null}</div>);
      }
    }
  }
  return <>
    <h1>{t("partner.title")}</h1>
    {unapplied.length ? <Section title={t("partner.apply")}><Form fields={[{ name: "organizationId", label: t("nav.org"), type: "select", options: unapplied.map((o: Json) => opt(o.organizationId, `${o.name} (${o.kind})`)) }, { name: "markets", label: t("partner.markets"), value: "market_pollachi" }]} submit={t("partner.apply")}
      onSubmit={(v) => c.post("/v1/partners", { organizationId: v.organizationId, serviceMarketIds: csv(v.markets) })} /></Section> : null}
    {out}
  </>;
};

// ---------- operations console ----------
const QUEUE_DECISIONS = { listing: ["APPROVE", "SUSPEND", "RETURN"], dispute: ["UPHELD", "PARTIALLY_UPHELD", "REJECTED", "WITHDRAWN", "SETTLED"] };
const ops: Page = async (c) => {
  if (!c.requireLogin()) return null;
  const { t } = c;
  if (!(c.me as Me).capabilities.some((x) => x.startsWith("ops."))) return <p className="err">403</p>;
  let q: Json;
  try { q = await c.api("GET", "/v1/ops/queues"); }
  catch (e) {
    if (problemOf(e).code !== "STEP_UP_REQUIRED") throw e;
    return <>
      <h1>{t("ops.title")}</h1>
      <Section title={t("ops.stepup")}>
        <button type="button" onClick={() => c.guard(async () => { await c.api("POST", "/v1/auth/step-up/request", {}); c.toast(t("login.sent")); })}>{t("ops.sendCode")}</button>
        <Form fields={[{ name: "code", label: t("login.code"), mode: "numeric", required: true }]} submit={t("ops.verify")} onSubmit={(v) => c.guard(async () => { await c.api("POST", "/v1/auth/step-up", { code: v.code }); c.toast(t("ops.stepupOk")); c.reload(); })} />
      </Section>
    </>;
  }
  const health = c.can("ops.source_health") ? await c.api("GET", "/v1/ops/source-health") : null;
  const audit = c.can("ops.audit") ? await c.api("GET", "/v1/ops/audit") : null;
  const reasonForm = (label: string, onSubmit: (v: Values) => Promise<unknown>, extra: Field[] = []) =>
    <Form fields={[...extra, { name: "reason", label: t("common.reason"), required: true }]} submit={label} onSubmit={(v) => c.guard(async () => { await onSubmit(v); c.reload(); })} />;
  const controls = (it: Json): ReactNode => {
    if (it.queue === "PRICE_REVIEW") return <div className="row">
      {reasonForm(t("ops.approve"), (v) => c.api("POST", `/v1/ops/observations/${it.subject}/review`, { decision: "APPROVE", reason: v.reason }))}
      {reasonForm(t("ops.reject"), (v) => c.api("POST", `/v1/ops/observations/${it.subject}/review`, { decision: "REJECT", reason: v.reason }))}
    </div>;
    if (it.queue === "MAPPING") return reasonForm(t("ops.resolve"), (v) => c.api("POST", `/v1/ops/mapping/${it.queueItemId}/resolve`, { mapping: { productId: v.productId, marketId: v.marketId, unit: v.unit }, reason: v.reason }),
      [{ name: "productId", label: t("sell.product"), type: "select", options: c.productOpts() }, { name: "marketId", label: t("sell.origin"), type: "select", options: c.marketOpts() }, { name: "unit", label: t("sell.unit"), type: "select", options: c.unitOpts("prod_mature_coconut") }]);
    if (it.queue === "VERIFICATION") {
      const isPartner = String(it.subject).startsWith("org_");
      return reasonForm(t("ops.decide"), (v) => isPartner ? c.api("POST", `/v1/ops/partners/${it.subject}/decision`, { decision: v.decision, reason: v.reason }) : c.api("POST", `/v1/ops/claims/${it.subject}/decision`, { decision: v.decision, reasonCode: v.reason }),
        [{ name: "decision", label: t("ops.decide"), type: "select", options: ["APPROVED", "REJECTED", ...(isPartner ? [] : ["NEEDS_MORE_INFORMATION"])].map((x) => opt(x, x)) }]);
    }
    if (it.queue === "LISTING_REVIEW") return reasonForm(t("ops.decide"), (v) => c.api("POST", `/v1/ops/listings/${it.subject}/review`, { decision: v.decision, reason: v.reason }), [{ name: "decision", label: t("ops.decide"), type: "select", options: QUEUE_DECISIONS.listing.map((x) => opt(x, x)) }]);
    if (it.queue === "DISPUTE") return reasonForm(t("ops.resolve"), (v) => c.api("POST", `/v1/ops/disputes/${it.subject}/resolve`, { outcome: v.outcome, reason: v.reason }), [{ name: "outcome", label: t("ops.outcome"), type: "select", options: QUEUE_DECISIONS.dispute.map((x) => opt(x, x)) }]);
    if (it.queue === "RISK") return reasonForm(t("ops.decide"), (v) => c.api("POST", `/v1/ops/users/${it.subject}/suspend`, { reason: v.reason }));
    return null;
  };
  return <>
    <h1>{t("ops.title")}</h1>
    <p className="hint">{t("ops.reasonRequired")}</p>
    <h2>{t("ops.queues")}</h2>
    {q.items.length ? null : <p>{t("ops.queueEmpty")}</p>}
    {q.items.map((it: Json) => <div className="card" key={it.queueItemId}>
      <b>{`${it.queue} · P${it.priority} · ${it.ageMinutes} min`}</b>
      <p>{it.summary}</p>
      <p className="hint">{it.reasons.join(", ")}</p>
      {controls(it)}
    </div>)}
    {health ? <Section title={t("ops.health")}><table><tbody>{health.items.map((x: Json) => <tr key={x.source}><td>{x.source}</td><td>{c.badge(x.status)}</td><td>{`retrieved ${x.retrieved} · unmapped ${x.unmapped} · rejected ${x.rejected}`}</td><td>{x.lastSuccessAt ? c.when(x.lastSuccessAt) : "—"}</td></tr>)}</tbody></table></Section> : null}
    {audit ? <Section title={t("ops.audit")}><table><tbody>{audit.items.slice(-30).reverse().map((x: Json, n: number) => <tr key={n}><td>{c.when(x.at)}</td><td>{x.action}</td><td>{x.subject}</td><td>{x.reason || ""}</td></tr>)}</tbody></table></Section> : null}
  </>;
};

/** Hash routes (`#/sell`, `#/deals/<id>`…); unknown routes fall back to prices, as before. */
export const PAGES: Record<string, Page> = { prices, login, me: account, sell, market, buy, deals, org, partner, ops };
