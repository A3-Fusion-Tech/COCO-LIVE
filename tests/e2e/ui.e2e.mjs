// Browser end-to-end check of the web app against a real (in-memory) API.
// Run: npm run test:e2e   (builds the web app first; skips if playwright is unavailable)
// Playwright is resolved from NODE_PATH or node_modules; the browser from CHROMIUM_PATH (default /opt/pw-browsers/chromium).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("playwright not installed; skipping UI e2e"); process.exit(0); }

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { LiveCoco, createApp, Collections } = await import("@livecoco/api");

const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

const otps = new Map();
// The web port is chosen first so signed upload URLs point at the web origin (uploads go through its /v1 proxy).
const webPort = await freePort();
const base = `http://127.0.0.1:${webPort}`;
const app = new LiveCoco({ baseUrl: base, deliverOtp: (ph, c) => otps.set(ph, c), operators: { "+919000000001": ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit"] } });
const sv = app.services;
const claims = () => app.run((s) => s.tx.find(Collections.claims));
const api = await createApp({ app });
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiBase = `http://127.0.0.1:${api.address().port}`;

// The production server exactly as deployed: `next start` (no custom server), configured through the environment.
const web = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", join(root, "apps", "web"), "-p", String(webPort), "-H", "127.0.0.1"], {
  env: { ...process.env, API_BASE_URL: apiBase, COOKIE_SECURE: "0", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "inherit", "inherit"],
});
for (let i = 0; ; i++) {
  try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
  if (i > 150) throw new Error("web did not start");
  await new Promise((r) => setTimeout(r, 200));
}

await app.run((s) => sv.prices.ingestRaw(s, "agmarknet", [{ state: "Tamil Nadu", market: "Pollachi", commodity: "Coconut", grade: "FAQ", arrival_date: new Date().toLocaleDateString("en-GB"), min_price: "2900", max_price: "3200", modal_price: "3050", price_unit: "Rs./Quintal" }]));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.error("FAIL:", msg); } else console.log("ok  :", msg); };
const errors = [];
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|status of 404/.test(m.text())) errors.push(m.text()); });
};
async function newUser(phone) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: "en-IN" });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${base}/login?lang=en`);
  await page.fill("input[type=tel]", phone);
  await page.click('button:has-text("Send code")');
  await page.waitForSelector("input[inputmode=numeric]");
  await page.fill("input[inputmode=numeric]", otps.get("+91" + phone));
  await page.click('button:has-text("Verify")');
  await page.waitForSelector('nav a[href="/sell"]');
  return { ctx, page };
}
/** Approves a PERSON_IDENTITY claim for the user directly in the store (stands in for an operator decision). */
const approveClaim = (phone) => app.run(async (s) => {
  const [u] = await s.tx.find(Collections.users, { phone: "+91" + phone });
  s.actor = { user: u, session: { token: "", userId: u.userId, createdAt: "", stepUpUntil: 0, revoked: false, device: "e2e" } };
  const c = await sv.identity.submitClaim(s, "PERSON_IDENTITY", {}, ["doc"]);
  s.tx.put(Collections.claims, c.claimId, { ...c, status: "APPROVED", verifiedAt: s.iso(), decidedBy: "e2e", reasonCode: "E2E" });
  await sv.queue.close(s, c.claimId);
});

try {
  // public price board: server-rendered, Tamil/English, cacheable, linked to the app
  const pub = await browser.newPage();
  watch(pub);
  await pub.goto(`${base}/?lang=ta`);
  check(new URL(pub.url()).pathname === "/ta", "/ redirects to the board in the chosen language");
  check((await pub.textContent("h1")).includes("தேங்காய்") && (await pub.getAttribute("html", "lang")) === "ta", "public price board renders Tamil");
  check((await pub.textContent("main")).includes("பொள்ளாச்சி"), "board shows the ingested Pollachi price");
  await pub.click("#lang");
  check((await pub.getAttribute("html", "lang")) === "en" && (await pub.textContent("h1")).includes("Coconut prices"), "board switches to English");
  check(await pub.locator('a[href="/login"]').count() === 1, "board links to sign-in / the app");
  const board = await fetch(`${base}/en`);
  check(board.status === 200 && /s-maxage=60/.test(board.headers.get("cache-control") ?? ""), "board is cacheable for a minute (ISR)");
  const appPage = await fetch(`${base}/market`);
  const csp = appPage.headers.get("content-security-policy") ?? "";
  check(appPage.status === 200 && /script-src 'self' 'nonce-[^']+'(;|$)/.test(csp) && !/unsafe-inline|unsafe-eval/.test(csp) && appPage.headers.get("x-content-type-options") === "nosniff", "app pages have a nonce-based CSP without inline relaxations, and nosniff");
  check((await fetch(`${base}/app`, { redirect: "manual" })).headers.get("location") === "/", "old /app URL redirects to the board");
  check((await fetch(`${base}/deals`, { redirect: "manual" })).headers.get("location") === "/login?next=%2Fdeals", "signed-in sections redirect to login without a session");
  check((await fetch(`${base}/v1/internal/tick`)).status === 404 && (await fetch(`${base}/missing`)).status === 404, "internal API routes and unknown paths are 404 at the web tier");
  check((await fetch(`${base}/healthz`)).status === 200, "health check");

  // seller signs in, creates + uploads + publishes a lot
  const s = await newUser("9800000001");
  await approveClaim("9800000001");
  await s.page.goto(`${base}/sell`);
  await s.page.waitForSelector('button:has-text("Create")');
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 16);
  const form = s.page.locator("form").first();
  await form.locator('label:has-text("Quantity") + input').fill("5000");
  await form.locator('label:has-text("Available from") + input').fill(day(1));
  await form.locator('label:has-text("Available until") + input').fill(day(5));
  await form.locator('label:has-text("Listing expires") + input').fill(day(7));
  await form.locator('label:has-text("Expected price") + input').fill("30");
  await form.locator("button[type=submit]").click();
  await s.page.waitForSelector("text=Draft");
  check(true, "seller created a draft lot via the form (server action)");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  await s.page.setInputFiles("input[type=file]", { name: "lot.png", mimeType: "image/png", buffer: png });
  await s.page.waitForSelector("text=Photo uploaded");
  check(true, "photo uploaded through the signed URL via the /v1 proxy");
  await app.run((s) => sv.maintenance.housekeeping(s)); // the worker's job: scan the upload so the photo counts
  await s.page.reload();
  await s.page.click('button:has-text("Publish")');
  await s.page.waitForSelector("text=Active");
  check(true, "seller published the lot");

  // buyer sees it in the market and makes an offer from the lot page
  const b = await newUser("9800000002");
  await approveClaim("9800000002");
  await b.page.goto(`${base}/market`);
  await b.page.waitForSelector("text=available");
  await b.page.click('a.btn:has-text("Make an offer")');
  await b.page.waitForSelector('label:has-text("Offer price")');
  await b.page.fill('label:has-text("Offer price") + input', "29");
  await b.page.locator('main form button[type=submit]').click();
  await b.page.waitForURL(`${base}/deals`);
  await b.page.waitForSelector("text=Offers");
  check(true, "buyer sent an offer from the lot page");

  // seller accepts → deal → confirm delivery → buyer accepts → seller confirms payment → complete
  await s.page.goto(`${base}/deals`);
  await s.page.click('button:has-text("Accept")');
  await s.page.waitForSelector("text=Deal Card");
  check(/\/deals\/[^/]+$/.test(new URL(s.page.url()).pathname), "accepting an offer opens the deal page");
  check((await s.page.textContent("main")).includes("does not guarantee payment"), "deal page states there is no payment guarantee");
  await s.page.click('button:has-text("Confirm delivery")');
  await s.page.waitForSelector(".badge:has-text('Delivered')");
  await b.page.reload();
  await b.page.locator("a.card").first().click();
  await b.page.click('button:has-text("Accept delivery")');
  await b.page.waitForSelector(".badge:has-text('Accepted')");
  await s.page.reload();
  await s.page.click('button:has-text("Confirm payment received")');
  await s.page.waitForSelector('button:has-text("Complete deal")');
  await s.page.click('button:has-text("Complete deal")');
  await s.page.waitForSelector(".badge:has-text('Completed')");
  check(true, "full deal lifecycle completed through the UI");

  // language toggle in the app (cookie-backed, server-rendered)
  await s.page.click("#lang");
  await s.page.waitForFunction(() => document.documentElement.lang === "ta");
  check((await s.page.textContent("nav")).includes("விலைகள்"), "app switches to Tamil");
  await s.page.goto(`${base}/me`);
  check((await s.page.getAttribute("html", "lang")) === "ta", "language choice persists across pages (cookie)");
  await s.page.goto(`${base}/me?lang=en`);

  // CSRF and session cookie properties
  const noHeader = await fetch(`${base}/v1/alerts`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check(noHeader.status === 403, "/v1 proxy rejects mutations without x-requested-with");
  const crossSiteAction = await fetch(`${base}/sell`, { method: "POST", headers: { origin: "https://evil.example", "next-action": "x", "content-type": "text/plain" }, body: "[]" });
  check(crossSiteAction.status >= 400, "server actions refuse a foreign Origin");
  const sess = (await s.ctx.cookies()).find((c) => c.name === "lc_session");
  check(sess?.httpOnly && sess.sameSite === "Strict", "session cookie is HttpOnly + SameSite=Strict");
  check((await s.page.evaluate(() => document.cookie)).includes("lc_session") === false, "session token is invisible to page JavaScript");

  // smoke every page for runtime errors
  for (const r of ["/me", "/buy", "/org", "/partner", "/sell", "/deals", "/alerts", "/market", "/en"]) {
    await s.page.goto(`${base}${r}`);
    await s.page.waitForSelector("h1");
  }
  check(true, "all pages render");

  // operator: elevated access needs an OTP step-up before queues are visible
  const o = await newUser("9000000001");
  await o.page.goto(`${base}/ops`);
  await o.page.waitForSelector("text=Confirm it is you");
  check(true, "operations console demands step-up");
  await o.page.click('button:has-text("Send code")');
  await o.page.waitForSelector("text=Code sent");
  await o.page.fill("input[inputmode=numeric]", otps.get("+919000000001"));
  await o.page.click('button:has-text("Confirm")');
  await o.page.waitForSelector("text=Review queues");
  check(true, "operator reaches review queues after step-up");

  // a verification claim submitted in the UI appears in the operator queue and is decided with a reason
  const c = await newUser("9800000003");
  await c.page.goto(`${base}/me`);
  await c.page.fill('label:has-text("Evidence note") + input', "Aadhaar ending 1234");
  await c.page.click('button:has-text("Submit for review")');
  await c.page.waitForSelector("text=Submitted for review");
  await o.page.reload();
  await o.page.waitForSelector("text=PERSON_IDENTITY claim submitted");
  const card = o.page.locator('.card:has-text("PERSON_IDENTITY claim submitted")').first();
  await card.locator('label:has-text("Reason") + input').fill("DOCS_OK");
  await card.locator("button[type=submit]").click();
  for (let i = 0; i < 40 && !(await claims()).some((x) => x.reasonCode === "DOCS_OK"); i++) await new Promise((r) => setTimeout(r, 100));
  check((await claims()).some((x) => x.status === "APPROVED" && x.decidedBy && x.reasonCode === "DOCS_OK"), "operator approved the claim with a reason code");

  // sign out clears the session
  await c.page.goto(`${base}/me`);
  await c.page.click('button:has-text("Sign out")');
  await c.page.waitForURL(/\/(ta|en)$/);
  check(!(await c.ctx.cookies()).some((x) => x.name === "lc_session" && x.value), "sign out clears the session cookie");
} catch (e) {
  failures.push(String(e)); console.error(e);
} finally {
  if (errors.length) { console.error("browser errors:", [...new Set(errors)].slice(0, 5).map((e) => e.slice(0, 300))); failures.push("browser console errors"); }
  await browser.close(); web.kill(); api.close();
}
if (failures.length) { console.error(`${failures.length} UI check(s) failed`); process.exit(1); }
console.log("UI e2e passed");
