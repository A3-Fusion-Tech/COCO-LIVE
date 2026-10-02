import { UI } from "/app/i18n.js";

// ---------- basics ----------
let lang = "ta";
try { lang = localStorage.getItem("lc_lang") === "en" ? "en" : "ta"; } catch { lang = "ta"; }
const t = (k) => (UI[lang] && UI[lang][k]) || UI.en[k] || k;
const $ = (s, el = document) => el.querySelector(s);
const state = { me: null, catalog: null, orgs: [] };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const toastEl = () => $("#toast");
function toast(msg, bad = false) { const el = toastEl(); el.replaceChildren(h("span", { class: bad ? "err" : "" }, msg)); setTimeout(() => el.replaceChildren(), 4000); }

class ApiError extends Error { constructor(p) { super(p.message || p.title || p.code || "error"); this.problem = p; } }
async function api(method, path, body, opts = {}) {
  const headers = { "x-requested-with": "livecoco", "accept-language": lang };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = opts.key || crypto.randomUUID();
  let res;
  try { res = await fetch(path + (path.includes("?") ? "&" : "?") + "lang=" + lang, { method, headers, credentials: "same-origin", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new ApiError({ code: "OFFLINE", message: t("err.offline") }); }
  const text = await res.text();
  if (opts.raw && res.ok) return text;
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError({ ...data, status: res.status });
  return data;
}
async function guard(fn) { try { return await fn(); } catch (e) { const p = e.problem || {}; toast(p.fieldErrors?.length ? `${p.message}: ${p.fieldErrors.map((f) => f.field).join(", ")}` : (p.detail && p.code === "VALIDATION_FAILED" ? p.detail : p.message || p.detail || t("err.generic")), true); if (p.status === 401) location.hash = "#/login"; return undefined; } }

const money = (paise) => new Intl.NumberFormat(lang === "ta" ? "ta-IN" : "en-IN", { style: "currency", currency: "INR", minimumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
const when = (iso) => new Intl.DateTimeFormat(lang === "ta" ? "ta-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
function toPaise(v) { const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(String(v)); if (!m) throw new ApiError({ message: `Invalid amount: ${v}` }); return Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0); }
const hoursFromNow = (n) => new Date(Date.now() + n * 3600000).toISOString();
const localIso = (v) => new Date(v).toISOString();
const csv = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
const pname = (id) => { const p = state.catalog?.products.find((x) => x.productId === id); return p ? p.name[lang] : id; };
const mname = (id) => { const m = state.catalog?.markets.find((x) => x.marketId === id); return m ? m.name[lang] : id; };
const badge = (s) => h("span", { class: "badge" }, t("status." + s) === "status." + s ? s : t("status." + s));

/** Build a form from field specs; values are read by name on submit. */
function form(fields, submitLabel, onSubmit, opts = {}) {
  const inputs = {};
  const el = h("form", { novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    const v = {};
    for (const f of fields) { const i = inputs[f.name]; v[f.name] = f.type === "checkbox" ? i.checked : i.value; }
    const btn = $("button[type=submit]", el); btn.disabled = true;
    try { await onSubmit(v, el); } finally { btn.disabled = false; }
  } });
  for (const f of fields) {
    const id = "f_" + Math.random().toString(36).slice(2, 8);
    let input;
    if (f.type === "select") input = h("select", { id }, (f.options || []).map((o) => h("option", { value: o.value, selected: o.value === f.value }, o.label)));
    else if (f.type === "textarea") input = h("textarea", { id, rows: 3 }, f.value || "");
    else input = h("input", { id, type: f.type || "text", value: f.value ?? "", ...(f.type === "checkbox" ? { checked: !!f.value } : {}), ...(f.type === "number" ? { step: "any", inputmode: "decimal" } : {}), ...(f.type === "tel" ? { inputmode: "tel", autocomplete: "tel" } : {}), ...((!f.type || f.type === "text") && f.mode ? { inputmode: f.mode } : {}), ...(f.required ? { required: true } : {}) });
    inputs[f.name] = input;
    if (f.type === "checkbox") el.append(h("div", { class: "row" }, input, h("label", { for: id, class: "inline" }, f.label)));
    else el.append(h("label", { for: id }, f.label), input);
    if (f.hint) el.append(h("p", { class: "hint" }, f.hint));
  }
  el.append(h("div", { class: "row actions" }, h("button", { type: "submit", class: opts.danger ? "danger" : "" }, submitLabel)));
  return el;
}
const opt = (value, label) => ({ value, label });
const productOpts = () => (state.catalog?.products || []).map((p) => opt(p.productId, p.name[lang]));
const marketOpts = () => (state.catalog?.markets || []).map((m) => opt(m.marketId, m.name[lang]));
const unitOpts = (pid) => ((state.catalog?.products.find((p) => p.productId === pid)?.units) || ["NUT", "KG", "QUINTAL", "TONNE"]).map((u) => opt(u, u));
const section = (title, ...kids) => h("section", { class: "card" }, h("h2", {}, title), ...kids);
const empty = () => h("p", { class: "hint" }, t("common.none"));
const kv = (obj) => h("table", {}, h("tbody", {}, Object.entries(obj).map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, typeof v === "object" ? JSON.stringify(v) : String(v))))));
const requireLogin = () => { if (!state.me) { location.hash = "#/login"; return false; } return true; };
const can = (cap) => !!state.me?.capabilities?.includes(cap);

// ---------- pages ----------
const pages = {};

pages.prices = async (root) => {
  const [prices, msp] = await Promise.all([api("GET", "/v1/prices/latest"), api("GET", "/v1/prices/msp")]);
  root.append(h("h1", {}, t("prices.title")), h("p", { class: "note", role: "note" }, t("prices.disclaimer")));
  if (!prices.items.length) root.append(h("p", {}, t("prices.none")));
  const grid = h("div", { class: "grid" });
  for (const i of prices.items) {
    const card = h("article", { class: "card" },
      h("h2", {}, `${pname(i.product.productId)} · ${lang === "ta" ? i.market.nameTa : i.market.name}`),
      h("p", { class: "hint" }, `${i.stage} · ${i.tradeTerm} · ${i.gradeGroup} · ${i.range.perUnit}`),
      h("div", { class: "range" }, [["price.low", i.range.low], ["price.reference", i.range.reference], ["price.high", i.range.high]].map(([k, v]) => h("div", {}, h("span", {}, t(k) === k ? k : k.split(".")[1]), h("b", {}, money(v.amountPaise))))),
      h("p", {}, h("span", { class: "badge" }, i.freshness), h("span", { class: "badge" }, i.confidence)),
      h("p", { class: "hint" }, `${t("prices.reported")}: ${when(i.observedWindow.endsAt)}`),
      i.messageKey ? h("p", { class: "note" }, i.kind === "OFFICIAL_OBSERVATION_ONLY" ? "Latest official market observation only" : "Evidence is limited / may be stale") : null,
      h("p", { class: "hint" }, `${i.evidenceSummary.observations} obs · ${i.evidenceSummary.independentOrganizations} org · ${i.evidenceSummary.officialMarketObservations} official · ${i.evidenceSummary.verifiedQuotes} quotes`),
    );
    const detail = h("div");
    card.append(h("div", { class: "row" },
      h("button", { class: "secondary", type: "button", onClick: () => guard(async () => { const ev = await api("GET", `/v1/prices/evidence?productId=${i.product.productId}&marketId=${i.market.marketId}&unit=${i.range.perUnit}&stage=${i.stage}`); detail.replaceChildren(h("pre", {}, ev.observations.map((o) => `${o.sourceClass} · ${when(o.observedAt)} · ${money(o.range.low.amountPaise)}–${money(o.range.high.amountPaise)}`).join("\n"))); }) }, t("prices.evidence")),
      h("button", { class: "secondary", type: "button", onClick: () => { if (!requireLogin()) return; detail.replaceChildren(form([
        { name: "direction", label: t("prices.direction"), type: "select", options: [opt("ABOVE", t("prices.above")), opt("BELOW", t("prices.below"))] },
        { name: "threshold", label: t("prices.threshold"), type: "number", required: true },
        { name: "channel", label: "Channel", type: "select", options: [opt("SMS", "SMS"), opt("WHATSAPP", "WhatsApp"), opt("PUSH", "Push")] },
        { name: "consent", label: t("prices.consent"), type: "checkbox" },
      ], t("common.save"), (v) => guard(async () => { await api("POST", "/v1/alerts", { productId: i.product.productId, marketId: i.market.marketId, unit: i.range.perUnit, stage: i.stage, direction: v.direction, thresholdPaise: toPaise(v.threshold), channel: v.channel, consent: v.consent }); toast(t("prices.alertSaved")); detail.replaceChildren(); }))); } }, t("prices.alert"))),
    detail);
    grid.append(card);
  }
  root.append(grid, h("p", { class: "hint" }, t("prices.msp")), h("ul", {}, msp.items.map((m) => h("li", {}, `${pname(m.productId)}: ${money(m.amountPaise)} / ${m.unit} — ${m.seasonLabel}`))));
  if (state.me) {
    const alerts = await api("GET", "/v1/alerts");
    root.append(section(t("prices.myAlerts"), alerts.items.length ? alerts.items.map((a) => h("div", { class: "row" }, h("span", {}, `${pname(a.productId)} ${a.direction} ${a.thresholdPaise ? money(a.thresholdPaise) : ""}`), badge(a.status),
      h("button", { class: "secondary", type: "button", onClick: () => guard(async () => { await api("PATCH", `/v1/alerts/${a.alertId}`, { status: a.status === "PAUSED" ? "ACTIVE" : "PAUSED" }); render(); }) }, a.status === "PAUSED" ? t("prices.resume") : t("prices.pause")),
      h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("PATCH", `/v1/alerts/${a.alertId}`, { status: "CANCELLED" }); render(); }) }, t("prices.cancel")))) : empty()));
  }
};

pages.login = async (root) => {
  root.append(h("h1", {}, t("login.title")));
  const codeBox = h("div");
  root.append(form([{ name: "phone", label: t("login.phone"), type: "tel", required: true, hint: "+91 …" }], t("login.send"), (v) => guard(async () => {
    await api("POST", "/v1/auth/otp/request", { phone: v.phone });
    toast(t("login.sent"));
    codeBox.replaceChildren(form([{ name: "code", label: t("login.code"), type: "text", mode: "numeric", required: true }], t("login.verify"), (c) => guard(async () => {
      const r = await fetch("/session/verify", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "livecoco" }, body: JSON.stringify({ phone: v.phone, code: c.code }) });
      if (!r.ok) throw new ApiError({ ...(await r.json()), status: r.status });
      await loadMe(); location.hash = "#/prices";
    })));
  })), codeBox);
};

pages.me = async (root) => {
  if (!requireLogin()) return;
  const me = state.me;
  root.append(h("h1", {}, t("me.title")));
  root.append(section(t("me.title"), form([
    { name: "displayName", label: t("me.name"), value: me.displayName },
    { name: "actingAs", label: t("me.acting"), type: "select", value: me.actingAs, options: [opt("INDEPENDENT", t("me.independent")), opt("ORGANIZATION", t("me.organization"))] },
    { name: "locale", label: t("me.language"), type: "select", value: me.locale, options: [opt("ta", "தமிழ்"), opt("en", "English")] },
  ], t("common.save"), (v) => guard(async () => { await api("PATCH", "/v1/me", v); toast(t("me.saved")); await loadMe(); }))));
  const types = ["PERSON_IDENTITY", "ORGANIZATION_EXISTENCE", "BUSINESS_DOCUMENT", "GST_DOCUMENT", "FSSAI_DOCUMENT", "PRICE_CONTRIBUTOR_SCOPE"];
  root.append(section(t("me.claims"),
    me.claims.length ? h("ul", {}, me.claims.map((c) => h("li", {}, `${c.type} — ${c.status}`))) : h("p", { class: "hint" }, t("me.claimNone")),
    form([{ name: "type", label: t("me.claimType"), type: "select", options: types.map((x) => opt(x, x)) }, { name: "evidence", label: t("me.claimEvidence"), required: true }, { name: "marketId", label: "Market (contributors)", type: "select", options: [opt("", "—"), ...marketOpts()] }, { name: "productId", label: "Product (contributors)", type: "select", options: [opt("", "—"), ...productOpts()] }],
      t("me.claimSubmit"), (v) => guard(async () => { const scope = {}; if (v.marketId) scope.marketId = v.marketId; if (v.productId) scope.productId = v.productId; await api("POST", "/v1/claims", { type: v.type, scope, evidence: [v.evidence] }); toast(t("me.claimSubmitted")); }))));
  const orgs = await api("GET", "/v1/me/organizations");
  state.orgs = orgs.items;
  root.append(section(t("nav.org"), orgs.items.length ? h("ul", {}, orgs.items.map((o) => h("li", {}, `${o.name} — ${o.kind} (${o.role})`))) : empty(),
    form([{ name: "name", label: t("me.orgName"), required: true }, { name: "kind", label: t("me.orgKind"), type: "select", options: ["FPO", "FARMER_GROUP", "TRADER", "PROCESSOR", "BUYER", "INSPECTION_PARTNER", "LOGISTICS_PARTNER"].map((k) => opt(k, k)) }], t("me.orgCreate"), (v) => guard(async () => { await api("POST", "/v1/organizations", v); render(); }))));
  root.append(h("button", { class: "secondary", type: "button", onClick: async () => { await fetch("/session/logout", { method: "POST", headers: { "x-requested-with": "livecoco" } }); state.me = null; nav(); location.hash = "#/prices"; } }, t("common.logout")));
};

const lotFields = (pid) => {
  const a = { prod_mature_coconut: [{ name: "husk", label: t("sell.husk"), value: "WITH_HUSK" }], prod_tender_coconut: [{ name: "size", label: t("sell.size"), value: "MEDIUM" }], prod_milling_copra: [{ name: "moisturePercent", label: t("sell.moisture"), value: "6" }], prod_ball_copra: [{ name: "moisturePercent", label: t("sell.moisture"), value: "7" }] };
  return a[pid] || [];
};

pages.sell = async (root) => {
  if (!requireLogin()) return;
  root.append(h("h1", {}, t("sell.title")));
  const create = h("div");
  const mk = (pid) => {
    create.replaceChildren(form([
      { name: "productId", label: t("sell.product"), type: "select", value: pid, options: productOpts() },
      ...lotFields(pid),
      { name: "unit", label: t("sell.unit"), type: "select", options: unitOpts(pid) },
      { name: "quantity", label: t("sell.quantity"), type: "text", mode: "decimal", required: true },
      { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" },
      { name: "origin", label: t("sell.origin"), type: "select", options: marketOpts() },
      { name: "price", label: t("sell.price"), type: "number" },
      { name: "from", label: t("sell.from"), type: "datetime-local", required: true },
      { name: "to", label: t("sell.to"), type: "datetime-local", required: true },
      { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true },
      { name: "mode", label: t("sell.pickup") + " / " + t("sell.delivery"), type: "select", options: [opt("PICKUP", t("sell.pickup")), opt("DELIVERY", t("sell.delivery"))] },
      { name: "costsIn", label: t("sell.costsIn"), value: "LOADING" },
      { name: "costsEx", label: t("sell.costsEx"), value: "TRANSPORT" },
      { name: "partial", label: t("sell.partial"), type: "checkbox", value: true },
      { name: "onBehalf", label: t("sell.listedFor") },
    ], t("common.create"), (v) => guard(async () => {
      const attrs = Object.fromEntries(lotFields(v.productId).map((f) => [f.name, v[f.name]]));
      await api("POST", "/v1/sell-lots", { productId: v.productId, gradeAttributes: attrs, gradeGroup: v.gradeGroup, unit: v.unit, quantityTotal: v.quantity, partialFulfilmentAllowed: v.partial, originMarketId: v.origin, availableFrom: localIso(v.from), availableTo: localIso(v.to), expiresAt: localIso(v.expires), fulfilment: { mode: v.mode, costsIncluded: csv(v.costsIn), costsExcluded: csv(v.costsEx) }, priceExpectation: v.price ? { unitPricePaise: toPaise(v.price) } : { inviteOffers: true }, ...(v.onBehalf ? { listedOnBehalfOf: v.onBehalf } : {}) });
      render();
    })));
    $("select", create).addEventListener("change", (e) => mk(e.target.value));
  };
  mk("prod_mature_coconut");
  root.append(section(t("sell.new"), create));
  const mine = await api("GET", "/v1/me/sell-lots");
  const list = h("div");
  for (const l of mine.items) {
    const extra = h("div");
    list.append(h("div", { class: "card" },
      h("h2", {}, `${pname(l.productId)} — ${l.quantityTotal} ${l.unit}`), badge(l.status),
      h("p", { class: "hint" }, `${mname(l.originMarketId)} · ${t("offers.expires")} ${when(l.expiresAt)} · reserved ${l.quantityReserved} · 📷 ${l.photoCount}`),
      h("div", { class: "row" },
        h("label", { class: "btn secondary pick" }, t("sell.photo"), h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", capture: "environment", class: "visually-hidden", onChange: (e) => uploadPhoto(e.target.files[0], l.sellLotId) })),
        l.status === "DRAFT" ? h("button", { type: "button", onClick: () => guard(async () => { await api("POST", `/v1/sell-lots/${l.sellLotId}/activate`, {}); render(); }) }, t("sell.activate")) : null,
        ["DRAFT", "ACTIVE", "PENDING_REVIEW"].includes(l.status) ? h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("POST", `/v1/sell-lots/${l.sellLotId}/withdraw`, {}); render(); }) }, t("sell.withdraw")) : null,
        h("button", { class: "secondary", type: "button", onClick: () => guard(async () => { const m = await api("GET", `/v1/sell-lots/${l.sellLotId}/matches`); extra.replaceChildren(h("h3", {}, t("sell.matches")), m.items.length ? m.items.map((x) => h("p", {}, `${x.requirementId} · ${x.score} · ${x.reasons.join(", ")}`)) : empty()); }) }, t("sell.matches"))), extra));
  }
  root.append(h("h2", {}, t("sell.mine")), mine.items.length ? list : empty());
};

async function uploadPhoto(file, lotId) {
  if (!file) return;
  await guard(async () => {
    const intent = await api("POST", "/v1/uploads/intents", { purpose: "LOT_PHOTO", contentType: file.type, sizeBytes: file.size, refId: lotId });
    const u = new URL(intent.uploadUrl, location.origin);
    const r = await fetch(u.pathname + u.search, { method: "PUT", body: file });
    if (!r.ok) throw new ApiError({ ...(await r.json().catch(() => ({}))), status: r.status });
    toast(t("sell.photoOk"));
  });
}

pages.market = async (root) => {
  root.append(h("h1", {}, t("market.title")));
  const lots = await api("GET", "/v1/sell-lots");
  if (!lots.items.length) root.append(h("p", {}, t("common.none")));
  for (const l of lots.items) {
    const box = h("div");
    root.append(h("article", { class: "card" }, h("h2", {}, `${pname(l.productId)} — ${l.quantityAvailable} ${l.unit} ${t("sell.available")}`),
      h("p", { class: "hint" }, `${mname(l.originMarketId)} · ${l.gradeGroup} · ${l.fulfilment.mode} · ${l.priceExpectation.unitPricePaise ? money(l.priceExpectation.unitPricePaise) : "—"}`),
      h("p", { class: "hint" }, `${l.verificationClaims.map((c) => c.type).join(", ") || "—"}`),
      h("button", { type: "button", onClick: () => { if (!requireLogin()) return; box.replaceChildren(form([
        { name: "qty", label: t("market.qty"), type: "text", mode: "decimal", value: l.quantityAvailable, required: true },
        { name: "price", label: t("market.unitPrice"), type: "number", required: true },
        { name: "hours", label: t("market.validHours"), type: "number", value: "24" },
        { name: "payment", label: t("market.payment"), type: "select", options: ["UPI", "CASH", "BANK_TRANSFER"].map((x) => opt(x, x)) },
        { name: "due", label: t("market.paymentDue"), type: "select", options: ["ON_LOADING", "ON_DELIVERY", "WITHIN_3_DAYS", "WITHIN_7_DAYS"].map((x) => opt(x, x)) },
        { name: "weigh", label: t("market.weighment"), type: "select", options: ["COUNT", "SCALE", "WEIGHBRIDGE"].map((x) => opt(x, x)) },
      ], t("market.offer"), (v) => guard(async () => {
        await api("POST", "/v1/offers", { sellLotId: l.sellLotId, expiresAt: hoursFromNow(Number(v.hours)), terms: { quantity: v.qty, unit: l.unit, unitPricePaise: toPaise(v.price), gradeGroup: l.gradeGroup, fulfilmentMode: l.fulfilment.mode, costsIncluded: l.fulfilment.costsIncluded, costsExcluded: l.fulfilment.costsExcluded, weighmentMethod: v.weigh, weighmentLocation: mname(l.originMarketId), paymentMethod: v.payment, paymentDue: v.due, fulfilmentFrom: l.availableFrom, fulfilmentBy: l.availableTo, acceptanceWindowHours: 24, inspectionTerms: "Buyer may inspect at loading" } });
        toast(t("market.sent")); box.replaceChildren(); location.hash = "#/deals";
      }))); } }, t("market.offer")), box));
  }
};

pages.buy = async (root) => {
  if (!requireLogin()) return;
  root.append(h("h1", {}, t("buy.title")));
  const verified = state.me.claims.some((c) => ["PERSON_IDENTITY", "ORGANIZATION_EXISTENCE"].includes(c.type));
  if (!verified) root.append(h("p", { class: "note" }, t("buy.verifyFirst")));
  root.append(section(t("buy.new"), form([
    { name: "productId", label: t("sell.product"), type: "select", options: productOpts() },
    { name: "unit", label: t("sell.unit"), type: "select", options: unitOpts("prod_mature_coconut") },
    { name: "target", label: t("buy.target"), mode: "decimal", required: true }, { name: "min", label: t("buy.min"), mode: "decimal" },
    { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" },
    { name: "dest", label: t("buy.dest"), type: "select", options: marketOpts() }, { name: "radius", label: t("buy.radius"), type: "number", value: "40" },
    { name: "from", label: t("sell.from"), type: "datetime-local", required: true }, { name: "by", label: t("buy.by"), type: "datetime-local", required: true }, { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true },
    { name: "maxPrice", label: t("buy.maxPrice"), type: "number" },
    { name: "repeat", label: t("buy.recurring"), type: "select", options: [opt("", t("buy.once")), opt("WEEKLY", "WEEKLY"), opt("FORTNIGHTLY", "FORTNIGHTLY"), opt("MONTHLY", "MONTHLY")] },
    { name: "times", label: "Occurrences", type: "number", value: "4" },
    { name: "partial", label: t("sell.partial"), type: "checkbox", value: true },
  ], t("common.create"), (v) => guard(async () => {
    const body = { productId: v.productId, gradeGroup: v.gradeGroup, unit: v.unit, targetQuantity: v.target, minQuantity: v.min || v.target, partialAllowed: v.partial, destinationMarketId: v.dest, maxRadiusKm: Number(v.radius), requiredFrom: localIso(v.from), requiredBy: localIso(v.by), expiresAt: localIso(v.expires), ...(v.maxPrice ? { maxUnitPricePaise: toPaise(v.maxPrice) } : {}) };
    if (v.repeat) await api("POST", "/v1/buy-requirements/recurring", { ...body, cadence: v.repeat, occurrences: Number(v.times) });
    else await api("POST", "/v1/buy-requirements", body);
    render();
  }))));
  const mine = await api("GET", "/v1/me/buy-requirements");
  for (const r of mine.items) {
    const extra = h("div");
    root.append(h("div", { class: "card" }, h("h2", {}, `${pname(r.productId)} — ${r.targetQuantity} ${r.unit}`), badge(r.status), h("p", { class: "hint" }, `${mname(r.destination.marketId)} · ${when(r.requiredBy)}`),
      h("div", { class: "row" }, h("button", { class: "secondary", type: "button", onClick: () => guard(async () => { const m = await api("GET", `/v1/buy-requirements/${r.requirementId}/matches`); extra.replaceChildren(h("h3", {}, t("buy.matches")), m.items.length ? m.items.map((x) => h("p", {}, `${x.sellLotId} · ${x.score} · ${x.reasons.join(", ")}`)) : empty()); }) }, t("buy.matches")),
        ["ACTIVE", "DRAFT"].includes(r.status) ? h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("POST", `/v1/buy-requirements/${r.requirementId}/close`, {}); render(); }) }, t("buy.close")) : null), extra));
  }
};

pages.deals = async (root, param) => {
  if (!requireLogin()) return;
  if (param) return dealDetail(root, param);
  root.append(h("h1", {}, t("offers.title")));
  const offers = await api("GET", "/v1/offers");
  if (!offers.items.length) root.append(empty());
  for (const o of offers.items) {
    const mineOffer = o.createdByPartyId === state.me.userId;
    const box = h("div");
    root.append(h("div", { class: "card" }, h("h2", {}, `${o.terms.quantity} ${o.terms.unit} @ ${money(o.terms.unitPricePaise)}`), badge(o.status),
      h("p", { class: "hint" }, `${t("offers.revision")} ${o.revision} · ${t("offers.expires")} ${when(o.expiresAt)} · ${t("offers.total")} ${money(o.estimatedTotalPaise)}`),
      o.status === "ACTIVE" ? h("div", { class: "row" },
        !mineOffer ? [
          h("button", { type: "button", onClick: () => guard(async () => { const d = await api("POST", `/v1/offers/${o.offerId}/accept`, {}, { key: "accept-" + o.offerId }); toast(t("offers.accepted")); location.hash = "#/deals/" + d.dealId; }) }, t("offers.accept")),
          h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("POST", `/v1/offers/${o.offerId}/reject`, {}); render(); }) }, t("offers.reject")),
          h("button", { class: "secondary", type: "button", onClick: () => box.replaceChildren(form([{ name: "price", label: t("market.unitPrice"), type: "number", required: true }, { name: "hours", label: t("market.validHours"), type: "number", value: "24" }], t("offers.counter"), (v) => guard(async () => { await api("POST", `/v1/offers/${o.offerId}/counter`, { terms: { ...o.terms, unitPricePaise: toPaise(v.price) }, expiresAt: hoursFromNow(Number(v.hours)) }); render(); }))) }, t("offers.counter"))] : null,
        mineOffer ? h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("POST", `/v1/offers/${o.offerId}/withdraw`, {}); render(); }) }, t("offers.withdraw")) : null) : null, box));
  }
  const deals = await api("GET", "/v1/deals");
  root.append(h("h1", {}, t("deals.title")), deals.items.length ? deals.items.map((d) => h("a", { class: "card linkcard", href: "#/deals/" + d.dealId }, h("b", {}, `${d.cards.at(-1).terms.quantity} ${d.cards.at(-1).terms.unit} @ ${money(d.cards.at(-1).terms.unitPricePaise)}`), " ", badge(d.status))) : empty());
};

async function dealDetail(root, id) {
  const d = await api("GET", `/v1/deals/${id}`);
  const card = d.cards.at(-1);
  const me = state.me.userId;
  const seller = d.sellerId === me, buyer = d.buyerId === me;
  const act = (label, path, body = {}, cls = "") => h("button", { type: "button", class: cls, onClick: () => guard(async () => { await api("POST", `/v1/deals/${id}/${path}`, body); render(); }) }, label);
  root.append(h("p", {}, h("a", { href: "#/deals" }, "← " + t("common.back"))), h("h1", {}, t("deals.title")), badge(d.status), h("p", { class: "note" }, t("deals.noGuarantee")));
  root.append(section(`${t("deals.card")} #${card.revision}`, kv({ [t("sell.quantity")]: `${card.terms.quantity} ${card.terms.unit}`, [t("market.unitPrice")]: money(card.terms.unitPricePaise), [t("offers.total")]: money(card.totalPaise), [t("market.payment")]: `${card.terms.paymentMethod} / ${card.terms.paymentDue}`, [t("market.weighment")]: card.terms.weighmentMethod, [t("sell.costsIn")]: card.terms.costsIncluded.join(", "), [t("sell.costsEx")]: card.terms.costsExcluded.join(", ") })));
  const actions = h("div", { class: "row" });
  const s = d.status;
  if (["AGREED", "PICKUP_CONFIRMED"].includes(s)) { actions.append(s === "AGREED" ? act(t("deals.pickup"), "pickup") : null); }
  if (seller && ["AGREED", "PICKUP_CONFIRMED"].includes(s)) actions.append(form([{ name: "actualQuantity", label: t("deals.actualQty"), mode: "decimal", value: card.terms.quantity }], t("deals.deliver"), (v) => guard(async () => { await api("POST", `/v1/deals/${id}/delivery`, { actualQuantity: v.actualQuantity }); render(); })));
  if (buyer && s === "DELIVERED") actions.append(act(t("deals.acceptDelivery"), "accept"));
  if (seller && ["ACCEPTED"].includes(s)) actions.append(act(t("deals.payment"), "payment", { method: card.terms.paymentMethod }));
  if (s === "PAYMENT_CONFIRMED") actions.append(act(t("deals.complete"), "complete"));
  if (["AGREED", "PICKUP_CONFIRMED", "INSPECTION_PENDING"].includes(s)) actions.append(form([{ name: "reason", label: t("common.reason"), required: true }], t("deals.cancel"), (v) => guard(async () => { await api("POST", `/v1/deals/${id}/cancel`, { reason: v.reason }); render(); }), { danger: true }));
  root.append(h("div", { class: "card" }, actions));
  if (d.pendingAmendment) root.append(section(t("deals.respondAmend"), kv({ proposedBy: d.pendingAmendment.proposedBy, ...d.pendingAmendment.terms }), d.pendingAmendment.proposedBy !== me ? h("div", { class: "row" }, h("button", { type: "button", onClick: () => guard(async () => { await api("POST", `/v1/deals/${id}/amendments/respond`, { accept: true }); render(); }) }, t("common.yes")), h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("POST", `/v1/deals/${id}/amendments/respond`, { accept: false }); render(); }) }, t("common.no"))) : null));
  else if (!["COMPLETED", "CANCELLED", "DISPUTED"].includes(s)) root.append(section(t("deals.amend"), form([{ name: "qty", label: t("sell.quantity"), value: card.terms.quantity, mode: "decimal" }, { name: "price", label: t("market.unitPrice"), type: "number", value: String(card.terms.unitPricePaise / 100) }], t("deals.amend"), (v) => guard(async () => { await api("POST", `/v1/deals/${id}/amendments`, { terms: { ...card.terms, quantity: v.qty, unitPricePaise: toPaise(v.price) } }); render(); }))));
  // inspection & transport
  if (s === "AGREED") {
    const partners = await api("GET", "/v1/partners?kind=INSPECTION");
    if (partners.items.length) root.append(section(t("deals.inspection"), form([{ name: "partnerId", label: t("deals.partner"), type: "select", options: partners.items.map((p) => opt(p.partnerId, p.name)) }, { name: "at", label: t("deals.scheduled"), type: "datetime-local", required: true }, { name: "loc", label: t("deals.location"), required: true }], t("deals.inspection"), (v) => guard(async () => { await api("POST", `/v1/deals/${id}/inspections`, { partnerId: v.partnerId, scheduledAt: localIso(v.at), location: v.loc }); render(); }))));
  }
  const insp = await api("GET", `/v1/deals/${id}/inspections`).catch(() => ({ items: [] }));
  for (const i of insp.items) root.append(section(`${t("deals.inspection")}: ${i.status}`, i.result ? kv({ outcome: i.result.outcome, ...i.result.measurements, note: i.result.note }) : null,
    buyer && i.status === "COMPLETED" ? h("div", { class: "row" }, h("button", { type: "button", onClick: () => guard(async () => { await api("POST", `/v1/inspections/${i.inspectionId}/decision`, { accept: true }); render(); }) }, t("offers.accept")), h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("POST", `/v1/inspections/${i.inspectionId}/decision`, { accept: false }); render(); }) }, t("offers.reject"))) : null));
  if (!["COMPLETED", "CANCELLED"].includes(s)) {
    const drop = h("div");
    root.append(section(t("deals.transport"), form([{ name: "dest", label: t("deals.destination"), type: "select", options: marketOpts() }, { name: "kg", label: t("deals.weight"), type: "number", required: true }, { name: "from", label: t("deals.window"), type: "datetime-local", required: true }, { name: "to", label: "→", type: "datetime-local", required: true }], t("deals.transport"), (v) => guard(async () => {
      const r = await api("POST", `/v1/deals/${id}/transport-requests`, { destinationMarketId: v.dest, weightKg: Number(v.kg), windowFrom: localIso(v.from), windowTo: localIso(v.to) });
      const q = await api("GET", `/v1/transport-requests/${r.requestId}/quotes`);
      drop.replaceChildren(q.items.length ? q.items.map((x) => h("p", {}, `${money(x.pricePaise)} · ${x.vehicleType}`, h("button", { type: "button", onClick: () => guard(async () => { await api("POST", `/v1/transport-quotes/${x.quoteId}/book`, { vehicle: { registration: "TBD", driverPhone: "TBD" } }); render(); }) }, t("common.open")))) : h("p", { class: "hint" }, `${r.requestId}`));
    })), drop));
  }
  if (["DELIVERED", "ACCEPTED", "PAYMENT_CONFIRMED", "AGREED", "PICKUP_CONFIRMED"].includes(s) && !d.disputeId) root.append(section(t("deals.dispute"), form([{ name: "reason", label: t("deals.disputeReason"), type: "select", options: ["QUANTITY_VARIANCE", "QUALITY_MISMATCH", "DAMAGE", "DELIVERY_FAILURE", "UNDISCLOSED_DEDUCTION", "NON_PAYMENT", "NO_SHOW"].map((x) => opt(x, x)) }, { name: "qty", label: t("sell.quantity"), mode: "decimal" }, { name: "amount", label: "₹", type: "number" }], t("deals.dispute"), (v) => guard(async () => { await api("POST", `/v1/deals/${id}/disputes`, { reason: v.reason, ...(v.qty ? { claimedQuantity: v.qty } : {}), ...(v.amount ? { claimedAmountPaise: toPaise(v.amount) } : {}) }); render(); }), { danger: true })));
  if (d.disputeId) {
    const dis = await api("GET", `/v1/disputes/${d.disputeId}`).catch(() => null);
    if (dis) root.append(section(`${t("deals.dispute")}: ${dis.status}`, kv({ reason: dis.reason, due: when(dis.responseDueAt), ...(dis.resolution ? { outcome: dis.resolution.outcome, why: dis.resolution.reason } : {}) }),
      dis.respondent === me && !dis.response ? form([{ name: "text", label: t("deals.evidence"), type: "textarea", required: true }], t("common.submit"), (v) => guard(async () => { await api("POST", `/v1/disputes/${d.disputeId}/response`, { text: v.text }); render(); })) : null));
  }
  root.append(section(t("deals.evidence"), form([{ name: "note", label: t("deals.evidence"), required: true }], t("common.save"), (v) => guard(async () => { await api("POST", `/v1/deals/${id}/evidence`, { kind: "NOTE", note: v.note }); render(); }))));
  root.append(section(t("deals.timeline"), h("ol", { class: "timeline" }, d.events.map((e) => h("li", {}, `${when(e.at)} — ${e.type}`)))));
}

pages.org = async (root) => {
  if (!requireLogin()) return;
  root.append(h("h1", {}, t("org.title")));
  const orgs = (await api("GET", "/v1/me/organizations")).items.filter((o) => ["FPO", "FARMER_GROUP"].includes(o.kind));
  if (!orgs.length) return root.append(empty());
  for (const o of orgs) {
    const members = (await api("GET", `/v1/organizations/${o.organizationId}/member-lots`)).items;
    const selected = new Set();
    const box = h("div", { class: "card" }, h("h2", {}, `${o.name} (${o.role})`));
    box.append(form([{ name: "memberName", label: t("org.memberName"), required: true }, { name: "productId", label: t("sell.product"), type: "select", options: productOpts() }, { name: "unit", label: t("sell.unit"), type: "select", options: unitOpts("prod_mature_coconut") }, { name: "quantity", label: t("sell.quantity"), mode: "decimal", required: true }, { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" }, { name: "origin", label: t("sell.origin"), type: "select", options: marketOpts() }, { name: "husk", label: t("sell.husk"), value: "WITH_HUSK" }],
      t("org.addMember"), (v) => guard(async () => { await api("POST", `/v1/organizations/${o.organizationId}/member-lots`, { memberName: v.memberName, productId: v.productId, gradeGroup: v.gradeGroup, unit: v.unit, quantity: v.quantity, originMarketId: v.origin, quality: { husk: v.husk } }); render(); })));
    box.append(h("h3", {}, t("org.members")), members.length ? h("table", {}, h("tbody", {}, members.map((m) => h("tr", {}, h("td", {}, m.status === "APPROVED" ? h("input", { type: "checkbox", "aria-label": m.memberName, onChange: (e) => (e.target.checked ? selected.add(m.memberLotId) : selected.delete(m.memberLotId)) }) : null), h("td", {}, `${m.memberName} — ${m.quantity} ${m.unit}`), h("td", {}, badge(m.status)),
      h("td", {}, m.status === "PENDING_REVIEW" ? h("div", { class: "row" }, h("button", { type: "button", onClick: () => guard(async () => { await api("POST", `/v1/member-lots/${m.memberLotId}/review`, { approve: true }); render(); }) }, t("org.review")), h("button", { class: "danger", type: "button", onClick: () => guard(async () => { await api("POST", `/v1/member-lots/${m.memberLotId}/review`, { approve: false }); render(); }) }, t("org.reject"))) : null))))) : empty());
    box.append(h("h3", {}, t("org.aggregate")), form([{ name: "from", label: t("sell.from"), type: "datetime-local", required: true }, { name: "to", label: t("sell.to"), type: "datetime-local", required: true }, { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true }, { name: "tol", label: "Tolerance %", type: "number", value: "2" }],
      t("org.aggregate"), (v) => guard(async () => { await api("POST", `/v1/organizations/${o.organizationId}/aggregates`, { memberLotIds: [...selected], tolerancePercent: Number(v.tol), availableFrom: localIso(v.from), availableTo: localIso(v.to), expiresAt: localIso(v.expires), fulfilment: { mode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: [] }, priceExpectation: { inviteOffers: true } }); render(); })));
    const deals = (await api("GET", "/v1/deals")).items.filter((d) => ["ACCEPTED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(d.status) && d.sellerId === state.me.userId);
    box.append(h("h3", {}, t("org.settlements")), deals.length ? deals.map((d) => h("div", { class: "card" }, h("b", {}, d.dealId), form([{ name: "ded", label: t("deals.deductions"), hint: "TRANSPORT:1500, COMMISSION:500" }], t("deals.settlement"), (v) => guard(async () => {
      const deductions = csv(v.ded).map((x) => { const [type, amt] = x.split(":"); return { type: type.trim(), amountPaise: toPaise(amt) }; });
      const s = await api("POST", `/v1/deals/${d.dealId}/settlement`, { deductions });
      toast(`${t("deals.settlement")}: ${money(s.netPaise)}`); render();
    })))) : empty());
    root.append(box);
  }
};

pages.partner = async (root) => {
  if (!requireLogin()) return;
  root.append(h("h1", {}, t("partner.title")));
  const orgs = (await api("GET", "/v1/me/organizations")).items.filter((o) => o.kind.endsWith("_PARTNER"));
  const mine = (await api("GET", "/v1/me/partners")).items;
  const unapplied = orgs.filter((o) => !mine.some((p) => p.organizationId === o.organizationId));
  if (unapplied.length) root.append(section(t("partner.apply"), form([{ name: "organizationId", label: t("nav.org"), type: "select", options: unapplied.map((o) => opt(o.organizationId, `${o.name} (${o.kind})`)) }, { name: "markets", label: t("partner.markets"), value: "market_pollachi" }], t("partner.apply"), (v) => guard(async () => { await api("POST", "/v1/partners", { organizationId: v.organizationId, serviceMarketIds: csv(v.markets) }); render(); }))));
  for (const p of mine) {
    root.append(h("div", { class: "card" }, h("b", {}, `${p.kind} — ${p.partnerId}`), " ", badge(p.status)));
    if (p.status !== "APPROVED") continue;
    const sla = await api("GET", `/v1/partners/${p.partnerId}/sla`);
    root.append(section(t("partner.sla"), kv({ inspections: sla.inspections, transport: sla.transport })));
    if (p.kind === "INSPECTION") {
      const jobs = (await api("GET", "/v1/partner/inspections")).items;
      root.append(h("h2", {}, t("partner.inspections")), jobs.length ? jobs.map((i) => h("div", { class: "card" }, h("b", {}, `${i.location} — ${when(i.scheduledAt)}`), " ", badge(i.status),
        i.status === "REQUESTED" ? h("button", { type: "button", onClick: () => guard(async () => { await api("POST", `/v1/inspections/${i.inspectionId}/accept`, {}); render(); }) }, t("partner.accept")) : null,
        i.status === "SCHEDULED" ? form([{ name: "outcome", label: t("partner.outcome"), type: "select", options: ["PASS", "FAIL", "CONDITIONAL"].map((x) => opt(x, x)) }, { name: "m", label: t("partner.measure"), value: "sampleSize:100" }, { name: "note", label: t("partner.note"), required: true }], t("partner.result"), (v) => guard(async () => { await api("POST", `/v1/inspections/${i.inspectionId}/result`, { outcome: v.outcome, measurements: Object.fromEntries(csv(v.m).map((x) => { const [k, n] = x.split(":"); return [k.trim(), Number(n)]; })), note: v.note }); render(); })) : null)) : empty());
    } else {
      const open = (await api("GET", "/v1/partner/transport-requests")).items;
      root.append(h("h2", {}, t("partner.open")), open.length ? open.map((r) => h("div", { class: "card" }, h("b", {}, `${mname(r.pickupMarketId)} → ${mname(r.destinationMarketId)} · ${r.weightKg} kg`), form([{ name: "price", label: t("partner.price"), type: "number", required: true }, { name: "vehicle", label: t("partner.vehicle"), value: "LCV" }, { name: "eta", label: "ETA", type: "datetime-local", required: true }], t("partner.quote"), (v) => guard(async () => { await api("POST", `/v1/transport-requests/${r.requestId}/quotes`, { pricePaise: toPaise(v.price), vehicleType: v.vehicle, etaFrom: localIso(v.eta), etaTo: localIso(v.eta), validUntil: hoursFromNow(24) }); render(); })))) : empty());
      const jobs = (await api("GET", "/v1/partner/transport-jobs")).items;
      for (const j of jobs.filter((x) => x.status !== "DELIVERED")) { const next = { BOOKED: "PICKED_UP", PICKED_UP: "IN_TRANSIT", IN_TRANSIT: "DELIVERED" }[j.status]; root.append(h("div", { class: "card" }, h("b", {}, `${j.requestId} — ${j.status}`), next ? h("button", { type: "button", onClick: () => guard(async () => { await api("POST", `/v1/transport-requests/${j.requestId}/status`, { status: next }); render(); }) }, `${t("partner.status")}: ${next}`) : null)); }
    }
  }
};

pages.ops = async (root) => {
  if (!requireLogin()) return;
  if (!state.me.capabilities.some((c) => c.startsWith("ops."))) return root.append(h("p", { class: "err" }, "403"));
  root.append(h("h1", {}, t("ops.title")));
  let q;
  try { q = await api("GET", "/v1/ops/queues"); }
  catch (e) {
    if (e.problem?.code !== "STEP_UP_REQUIRED") throw e;
    root.append(section(t("ops.stepup"), h("button", { type: "button", onClick: () => guard(async () => { await api("POST", "/v1/auth/step-up/request", {}); toast(t("login.sent")); }) }, t("ops.sendCode")),
      form([{ name: "code", label: t("login.code"), mode: "numeric", required: true }], t("ops.verify"), (v) => guard(async () => { await api("POST", "/v1/auth/step-up", { code: v.code }); toast(t("ops.stepupOk")); render(); }))));
    return;
  }
  root.append(h("p", { class: "hint" }, t("ops.reasonRequired")), h("h2", {}, t("ops.queues")));
  if (!q.items.length) root.append(h("p", {}, t("ops.queueEmpty")));
  for (const it of q.items) {
    const done = (fn) => guard(async () => { await fn(); render(); });
    let controls;
    const reasonForm = (label, onSubmit, extra = []) => form([...extra, { name: "reason", label: t("common.reason"), required: true }], label, (v) => done(() => onSubmit(v)));
    if (it.queue === "PRICE_REVIEW") controls = h("div", { class: "row" }, reasonForm(t("ops.approve"), (v) => api("POST", `/v1/ops/observations/${it.subject}/review`, { decision: "APPROVE", reason: v.reason })), reasonForm(t("ops.reject"), (v) => api("POST", `/v1/ops/observations/${it.subject}/review`, { decision: "REJECT", reason: v.reason })));
    else if (it.queue === "MAPPING") controls = reasonForm(t("ops.resolve"), (v) => api("POST", `/v1/ops/mapping/${it.queueItemId}/resolve`, { mapping: { productId: v.productId, marketId: v.marketId, unit: v.unit }, reason: v.reason }), [{ name: "productId", label: t("sell.product"), type: "select", options: productOpts() }, { name: "marketId", label: t("sell.origin"), type: "select", options: marketOpts() }, { name: "unit", label: t("sell.unit"), type: "select", options: unitOpts("prod_mature_coconut") }]);
    else if (it.queue === "VERIFICATION") {
      const isPartner = it.subject.startsWith("org_");
      controls = reasonForm(t("ops.decide"), (v) => isPartner ? api("POST", `/v1/ops/partners/${it.subject}/decision`, { decision: v.decision, reason: v.reason }) : api("POST", `/v1/ops/claims/${it.subject}/decision`, { decision: v.decision, reasonCode: v.reason }), [{ name: "decision", label: t("ops.decide"), type: "select", options: ["APPROVED", "REJECTED", ...(isPartner ? [] : ["NEEDS_MORE_INFORMATION"])].map((x) => opt(x, x)) }]);
    } else if (it.queue === "LISTING_REVIEW") controls = reasonForm(t("ops.decide"), (v) => api("POST", `/v1/ops/listings/${it.subject}/review`, { decision: v.decision, reason: v.reason }), [{ name: "decision", label: t("ops.decide"), type: "select", options: ["APPROVE", "SUSPEND", "RETURN"].map((x) => opt(x, x)) }]);
    else if (it.queue === "DISPUTE") controls = reasonForm(t("ops.resolve"), (v) => api("POST", `/v1/ops/disputes/${it.subject}/resolve`, { outcome: v.outcome, reason: v.reason }), [{ name: "outcome", label: t("ops.outcome"), type: "select", options: ["UPHELD", "PARTIALLY_UPHELD", "REJECTED", "WITHDRAWN", "SETTLED"].map((x) => opt(x, x)) }]);
    else if (it.queue === "RISK") controls = reasonForm(t("ops.decide"), (v) => api("POST", `/v1/ops/users/${it.subject}/suspend`, { reason: v.reason }), []);
    root.append(h("div", { class: "card" }, h("b", {}, `${it.queue} · P${it.priority} · ${it.ageMinutes} min`), h("p", {}, it.summary), h("p", { class: "hint" }, it.reasons.join(", ")), controls));
  }
  if (can("ops.source_health")) { const sh = await api("GET", "/v1/ops/source-health"); root.append(section(t("ops.health"), h("table", {}, h("tbody", {}, sh.items.map((x) => h("tr", {}, h("td", {}, x.source), h("td", {}, badge(x.status)), h("td", {}, `retrieved ${x.retrieved} · unmapped ${x.unmapped} · rejected ${x.rejected}`), h("td", {}, x.lastSuccessAt ? when(x.lastSuccessAt) : "—"))))))); }
  if (can("ops.audit")) { const a = await api("GET", "/v1/ops/audit"); root.append(section(t("ops.audit"), h("table", {}, h("tbody", {}, a.items.slice(-30).reverse().map((x) => h("tr", {}, h("td", {}, when(x.at)), h("td", {}, x.action), h("td", {}, x.subject), h("td", {}, x.reason || "")))))));  }
};

// ---------- shell ----------
function nav() {
  const links = [["prices", "nav.prices"], ["market", "nav.market"]];
  if (state.me) links.push(["sell", "nav.sell"], ["buy", "nav.buy"], ["deals", "nav.deals"], ["org", "nav.org"], ["partner", "nav.partner"], ["me", "nav.me"]);
  if (state.me?.capabilities?.some((c) => c.startsWith("ops."))) links.push(["ops", "nav.ops"]);
  if (!state.me) links.push(["login", "nav.login"]);
  const cur = (location.hash.slice(2) || "prices").split("/")[0];
  $("#nav").replaceChildren(...links.map(([r, k]) => h("a", { href: "#/" + r, ...(cur === r ? { "aria-current": "page" } : {}) }, t(k))));
  $("#lang").textContent = lang === "ta" ? "English" : "தமிழ்";
  document.documentElement.lang = lang;
}
async function loadMe() { try { state.me = await api("GET", "/v1/me"); } catch { state.me = null; } nav(); }
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const [route, param] = (location.hash.slice(2) || "prices").split("/");
  const root = h("div");
  // pages append arrays of nodes freely; flatten and drop empties like h() does
  root.append = (...kids) => Element.prototype.append.apply(root, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  nav();
  try { if (!state.catalog) state.catalog = await api("GET", "/v1/catalog"); await (pages[route] || pages.prices)(root, param); }
  catch (e) { root.append(h("p", { class: "err" }, e.problem?.message || t("err.generic"))); if (e.problem?.status === 401) location.hash = "#/login"; }
  if (seq !== renderSeq) return;
  $("#main").replaceChildren(root);
  $("#main").focus({ preventScroll: true });
}
$("#lang").addEventListener("click", () => { lang = lang === "ta" ? "en" : "ta"; try { localStorage.setItem("lc_lang", lang); } catch { /* storage unavailable */ } render(); });
window.addEventListener("hashchange", render);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
await loadMe();
await render();
