// Browser end-to-end check of the PWA against a real API + Postgres-less platform.
// Run: npm run build:web && NODE_PATH=<dir containing playwright> node --import tsx tests/e2e/ui.e2e.mjs   (skips if playwright is unavailable)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("playwright not installed; skipping UI e2e"); process.exit(0); }

const { Platform } = await import("../../apps/api/src/platform.ts");
const { createApp } = await import("../../apps/api/src/server.ts");
const { createWeb } = await import("../../apps/web/src/server.ts");

const otps = new Map();
const p = new Platform({ deliverOtp: (ph, c) => otps.set(ph, c), operators: { "+919000000001": ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit"] } });
const api = await createApp({ platform: p, internalToken: "tok" });
await new Promise((r) => api.listen(0, r));
const web = await createWeb({ apiBaseUrl: `http://127.0.0.1:${api.address().port}`, secureCookies: false });
await new Promise((r) => web.listen(0, r));
const base = `http://127.0.0.1:${web.address().port}`;
p.fx.baseUrl = base;

p.ingestRaw("agmarknet", [{ state: "Tamil Nadu", market: "Pollachi", commodity: "Coconut", grade: "FAQ", arrival_date: new Date().toLocaleDateString("en-GB"), min_price: "2900", max_price: "3200", modal_price: "3050", price_unit: "Rs./Quintal" }]);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.error("FAIL:", msg); } else console.log("ok  :", msg); };
const errors = [];
async function newUser(phone) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: "en-IN" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/app/#/login`);
  await page.evaluate(() => localStorage.setItem("lc_lang", "en")); await page.reload();
  await page.fill('input[type=tel]', phone);
  await page.click('button:has-text("Send code")');
  await page.waitForSelector('input[inputmode=numeric]');
  await page.fill('input[inputmode=numeric]', otps.get("+91" + phone));
  await page.click('button:has-text("Verify")');
  await page.waitForSelector('a[href="#/sell"]');
  return { ctx, page };
}
const verify = (phone, type) => { const u = [...p.users.values()].find((x) => x.phone === "+91" + phone); const c = p.submitClaim(u, type, {}, ["doc"]); const op = [...p.users.values()].find((x) => x.phone === "+919000000001"); return { c, op, u }; };

try {
  // public SSR page + link to app; Tamil/English
  const pub = await browser.newPage();
  await pub.goto(`${base}/?lang=ta`);
  check((await pub.textContent("h1")).includes("தேங்காய்"), "public price page renders Tamil");
  check(await pub.locator('a[href="/app/"]').count() === 1, "public page links to the app");
  const shell = await fetch(`${base}/app/`);
  const csp = shell.headers.get("content-security-policy") ?? "";
  check(shell.status === 200 && /script-src 'self' 'nonce-[^']+'(;|$)/.test(csp) && !/unsafe-inline|unsafe-eval/.test(csp) && shell.headers.get("x-content-type-options") === "nosniff", "app shell has a nonce-based CSP without inline relaxations, and nosniff");
  check((await fetch(`${base}/app`, { redirect: "manual" })).headers.get("location")?.endsWith("/app/"), "/app redirects to /app/");
  check((await fetch(`${base}/v1/internal/tick`)).status === 404 && (await fetch(`${base}/missing`)).status === 404, "internal API routes and unknown paths are 404 at the web tier");

  // seller signs in, creates + uploads + publishes a lot
  const s = await newUser("9800000001");
  const sellerUser = [...p.users.values()].find((x) => x.phone === "+919800000001");
  // approve identity so the lot publishes without review
  const ops = [...p.users.values()].find((x) => x.phone === "+919000000001") ?? null;
  void ops;
  const claim = p.submitClaim(sellerUser, "PERSON_IDENTITY", {}, ["doc"]);
  p.claims.get(claim.claimId).status = "APPROVED"; for (const q of p.queue.values()) if (q.subject === claim.claimId) q.status = "DONE";
  await s.page.goto(`${base}/app/#/sell`);
  await s.page.waitForSelector('button:has-text("Create")');
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 16);
  const form = s.page.locator("form").first();
  await form.locator('label:has-text("Quantity") + input').fill("5000");
  await form.locator('label:has-text("Available from") + input').fill(day(1));
  await form.locator('label:has-text("Available until") + input').fill(day(5));
  await form.locator('label:has-text("Listing expires") + input').fill(day(7));
  await form.locator('label:has-text("Expected price") + input').fill("30");
  await form.locator('button[type=submit]').click();
  await s.page.waitForSelector('text=Draft');
  check(true, "seller created a draft lot via the form");
  // upload a real PNG header via the file input
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  await s.page.setInputFiles('input[type=file]', { name: "lot.png", mimeType: "image/png", buffer: png });
  await s.page.waitForSelector('text=Photo uploaded');
  check(true, "photo uploaded through signed URL via the web gateway");
  await fetch(`http://127.0.0.1:${api.address().port}/v1/internal/tick`, { method: "POST", headers: { "x-internal-token": "tok" }, body: "{}" });
  await s.page.reload();
  await s.page.click('button:has-text("Publish")');
  await s.page.waitForSelector('text=Active');
  check(true, "seller published the lot");

  // buyer sees it in the market and makes an offer
  const b = await newUser("9800000002");
  const buyerUser = [...p.users.values()].find((x) => x.phone === "+919800000002");
  const bc = p.submitClaim(buyerUser, "PERSON_IDENTITY", {}, ["doc"]); p.claims.get(bc.claimId).status = "APPROVED"; for (const q of p.queue.values()) if (q.subject === bc.claimId) q.status = "DONE";
  await b.page.goto(`${base}/app/#/market`);
  await b.page.waitForSelector('text=available');
  await b.page.click('button:has-text("Make an offer")');
  await b.page.fill('label:has-text("Offer price") + input', "29");
  await b.page.locator('form button[type=submit]').click();
  await b.page.waitForSelector('text=Offers');
  check(true, "buyer sent an offer from the market page");

  // seller accepts → deal → confirm delivery → buyer accepts → seller confirms payment
  await s.page.goto(`${base}/app/#/deals`);
  await s.page.click('button:has-text("Accept")');
  await s.page.waitForSelector('text=Deal Card');
  check((await s.page.textContent("main")).includes("does not guarantee payment"), "deal page states there is no payment guarantee");
  await s.page.click('button:has-text("Confirm delivery")');
  await s.page.waitForSelector('text=Delivered');
  await b.page.reload();
  await b.page.locator('a.card').first().click();
  await b.page.click('button:has-text("Accept delivery")');
  await b.page.waitForSelector('text=Accepted');
  await s.page.reload();
  await s.page.click('button:has-text("Confirm payment received")');
  await s.page.waitForSelector('button:has-text("Complete deal")');
  await s.page.click('button:has-text("Complete deal")');
  await s.page.waitForSelector('text=Completed');
  check(true, "full deal lifecycle completed through the UI");

  // language toggle to Tamil on the app
  await s.page.click("#lang");
  check((await s.page.textContent("nav")).includes("விலைகள்"), "app switches to Tamil");

  // CSRF: mutation without the header is refused at the gateway
  const noHeader = await fetch(`${base}/v1/alerts`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check(noHeader.status === 403, "gateway rejects cross-site style mutations");
  const cookies = await s.ctx.cookies();
  const sess = cookies.find((c) => c.name === "lc_session");
  check(sess?.httpOnly && sess.sameSite === "Strict", "session cookie is HttpOnly + SameSite=Strict");
  check((await s.page.evaluate(() => document.cookie)).includes("lc_session") === false, "session token is invisible to page JavaScript");

  // smoke every authenticated page for runtime errors
  for (const r of ["me", "buy", "org", "partner", "sell", "deals", "market", "prices"]) {
    await s.page.goto(`${base}/app/#/${r}`); await s.page.reload(); await s.page.waitForSelector("h1");
  }
  check(true, "all authenticated pages render without console errors");

  // operator: elevated access needs an OTP step-up before queues are visible
  const o = await newUser("9000000001");
  await o.page.goto(`${base}/app/#/ops`); await o.page.reload();
  await o.page.waitForSelector('text=Confirm it is you');
  check(true, "operations console demands step-up");
  await o.page.click('button:has-text("Send code")');
  await o.page.waitForTimeout(300);
  await o.page.fill('input[inputmode=numeric]', otps.get("+919000000001"));
  await o.page.click('button:has-text("Confirm")');
  await o.page.waitForSelector('text=Review queues');
  check(true, "operator reaches review queues after step-up");

  // verification claim submitted in the UI appears in the operator queue and can be decided with a reason
  const c = await newUser("9800000003");
  await c.page.goto(`${base}/app/#/me`); await c.page.reload();
  await c.page.fill('label:has-text("Evidence note") + input', "Aadhaar ending 1234");
  await c.page.click('button:has-text("Submit for review")');
  await c.page.waitForSelector('text=Submitted for review');
  await o.page.reload();
  await o.page.waitForSelector('text=PERSON_IDENTITY claim submitted');
  const card = o.page.locator('.card:has-text("PERSON_IDENTITY claim submitted")').first();
  await card.locator('label:has-text("Reason") + input').fill("DOCS_OK");
  await card.locator('button[type=submit]').click();
  for (let i = 0; i < 40 && ![...p.claims.values()].some((x) => x.reasonCode === "DOCS_OK"); i++) await new Promise((r) => setTimeout(r, 100));
  check([...p.claims.values()].some((x) => x.status === "APPROVED" && x.decidedBy && x.reasonCode === "DOCS_OK"), "claim approved with the operator's reason code");
  check(true, "operator decided a verification claim from the queue");
} catch (e) {
  failures.push(String(e)); console.error(e);
} finally {
  if (errors.length) { console.error("browser errors:", [...new Set(errors)].slice(0, 5).map((e) => e.slice(0, 300))); failures.push("browser console errors"); }
  await browser.close(); web.close(); api.close();
}
if (failures.length) { console.error(`${failures.length} UI check(s) failed`); process.exit(1); }
console.log("UI e2e passed");
