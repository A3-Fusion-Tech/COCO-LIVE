import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DomainError, conflict, forbidden, invalid, notFound,
  MARKETS, PRODUCTS, SOURCE_COMMODITY_MAP, SOURCE_MARKET_MAP, SOURCE_UNIT_MAP,
  aggregate, bucketKey, detectAnomalies, effectiveConfidence, freshness, transitionObservation, validateObservation,
  addQuantity, subtractQuantity, compareQuantity, toMilli, haversineKm,
  assertLotTransition, assertOfferAcceptable, assertDealTransition, availableQuantity, currentCard, isMaterialLotChange,
  instantiateRecurrence, matchLotToRequirement, publicLotView, rankMatches, reputationSummary, totalForTerms,
  validateLotForActivation, validateOfferTerms, validateRequirement, MATERIAL_TERM_FIELDS, DISPUTE_RESPONSE_HOURS,
  type Aggregate, type AggregateResult, type BuyRequirement, type Deal, type DealEvent, type DealEventType, type Dispute,
  type DisputeOutcome, type DisputeReason, type MatchCandidate, type MspReference, type Offer, type OfferTerms,
  type ParticipantState, type PriceObservation, type RecurrenceTemplate, type ReputationEvent, type SellLot, type SourceClass,
  type MarketStage, type ProductId, type TradeTerm, type Unit, type Cadence, type FulfilmentTerm, type ObservationState,
} from "../../../packages/domain/src/index.ts";

export type Capability =
  | "price.contribute" | "ops.price_review" | "ops.source_health" | "ops.verification" | "ops.listings" | "ops.disputes" | "ops.audit" | "ops.sensitive_documents";

export interface User {
  userId: string;
  phone: string;
  displayName: string;
  actingAs: "INDEPENDENT" | "ORGANIZATION";
  organizationIds: string[];
  capabilities: Capability[];
  suspended: boolean;
  blocked: string[];
  locale: "en" | "ta";
  createdAt: string;
}
export interface Session { token: string; userId: string; createdAt: string; stepUpUntil: number; revoked: boolean; device: string }
export interface Organization { organizationId: string; name: string; kind: "FARMER_GROUP" | "FPO" | "TRADER" | "PROCESSOR" | "BUYER"; members: { userId: string; role: "OWNER" | "MEMBER" | "FINANCE" | "VERIFIER" }[] }
export type ClaimType = "MOBILE_CONTROL" | "PERSON_IDENTITY" | "ORGANIZATION_EXISTENCE" | "ORGANIZATION_MEMBERSHIP" | "BUSINESS_DOCUMENT" | "FSSAI_DOCUMENT" | "GST_DOCUMENT" | "MARKET_LICENSE_DOCUMENT" | "PAYMENT_DESTINATION" | "PRICE_CONTRIBUTOR_SCOPE" | "LOT_STOCK";
export type ClaimStatus = "NOT_STARTED" | "EVIDENCE_REQUESTED" | "SUBMITTED" | "IN_REVIEW" | "NEEDS_MORE_INFORMATION" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
export interface VerificationClaim { claimId: string; userId: string; type: ClaimType; scope: Record<string, string>; status: ClaimStatus; evidenceIds: string[]; verifiedAt: string | undefined; expiresAt: string | undefined; decidedBy: string | undefined; reasonCode: string | undefined }
export interface Evidence { evidenceId: string; ownerId: string; dealId: string | undefined; kind: string; visibleTo: string[]; note: string; at: string; sensitive: boolean }
export interface AuditEntry { seq: number; at: string; actorId: string; action: string; subject: string; reason: string | undefined; correlationId: string; meta: Record<string, unknown> }
export interface RawRecord { rawId: string; source: string; hash: string; payload: Record<string, unknown>; receivedAt: string; parserVersion: string; parsed: boolean; unmapped: string[] }
export interface SourceHealthRecord { source: string; lastAttemptAt: string | undefined; lastSuccessAt: string | undefined; lastError: string | undefined; lastObservationAt: string | undefined; retrieved: number; normalized: number; unmapped: number; rejected: number; disabled: boolean; consecutiveFailures: number }
export interface AlertSubscription { alertId: string; userId: string; productId: ProductId; marketId: string; unit: Unit; stage: MarketStage; direction: "ABOVE" | "BELOW" | "BULLETIN"; thresholdPaise: number | undefined; channel: "SMS" | "WHATSAPP" | "PUSH"; consentAt: string; status: "ACTIVE" | "PAUSED" | "CANCELLED"; lastTriggeredKey: string | undefined }
export interface Notification { notificationId: string; userId: string; channel: string; template: string; data: Record<string, unknown>; dedupeKey: string; at: string }
export interface QueueItem { queueItemId: string; queue: "PRICE_REVIEW" | "MAPPING" | "VERIFICATION" | "LISTING_REVIEW" | "DISPUTE" | "RISK"; subject: string; summary: string; reasons: string[]; priority: number; createdAt: string; requiredCapability: Capability; status: "OPEN" | "DONE" }
export interface Thread { threadId: string; sellLotId: string; sellerId: string; buyerId: string; offerIds: string[]; contactRevealed: boolean }
export interface Report { reportId: string; reporterId: string; subjectUserId: string; reason: string; at: string }

export interface Config {
  clock: () => Date;
  operators: Record<string, Capability[]>; // phone → capabilities
  otpTtlMs: number;
  otpMaxPerHour: number;
  stepUpMs: number;
  contactRevealPerDay: number;
  acceptanceWindowFallbackHours: number;
  /** Test hook: capture OTPs delivered through the "console" provider. */
  deliverOtp: (phone: string, code: string) => void;
}

export const defaultConfig = (): Config => ({
  clock: () => new Date(),
  operators: {},
  otpTtlMs: 5 * 60_000,
  otpMaxPerHour: 5,
  stepUpMs: 15 * 60_000,
  contactRevealPerDay: 10,
  acceptanceWindowFallbackHours: 48,
  deliverOtp: () => {},
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  const d = digits.replace(/^\+/, "");
  if (/^91\d{10}$/.test(d)) return `+${d}`;
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  throw invalid("INVALID_PHONE", "Phone number must be a valid Indian mobile number");
}

export class Platform {
  readonly cfg: Config;
  users = new Map<string, User>();
  phoneIndex = new Map<string, string>();
  sessions = new Map<string, Session>();
  otps = new Map<string, { hash: string; expires: number; attempts: number; used: boolean }>();
  otpRequests = new Map<string, number[]>();
  orgs = new Map<string, Organization>();
  claims = new Map<string, VerificationClaim>();
  evidence = new Map<string, Evidence>();
  audit: AuditEntry[] = [];
  raw = new Map<string, RawRecord>();
  observations = new Map<string, PriceObservation>();
  aggregates = new Map<string, Aggregate[]>(); // bucket → history (latest last)
  unpublishable = new Map<string, PriceObservation[]>();
  sourceHealth = new Map<string, SourceHealthRecord>();
  msp: MspReference[] = [{ productId: "prod_milling_copra", unit: "QUINTAL", amountPaise: 1158200, seasonLabel: "2025 season (policy reference)", isMarketQuote: false }];
  alerts = new Map<string, AlertSubscription>();
  notifications: Notification[] = [];
  queue = new Map<string, QueueItem>();
  lots = new Map<string, SellLot>();
  requirements = new Map<string, BuyRequirement>();
  templates = new Map<string, RecurrenceTemplate>();
  threads = new Map<string, Thread>();
  offers = new Map<string, Offer>();
  deals = new Map<string, Deal>();
  disputes = new Map<string, Dispute>();
  reputation: ReputationEvent[] = [];
  reveals: { at: number; by: string; of: string; reason: string }[] = [];
  reports: Report[] = [];
  idempotency = new Map<string, { hash: string; result: unknown }>();
  correlationId = "req_internal";

  constructor(cfg: Partial<Config> = {}) {
    this.cfg = { ...defaultConfig(), ...cfg };
  }
  now() { return this.cfg.clock(); }
  iso() { return this.now().toISOString(); }

  // ---- audit ---------------------------------------------------------
  log(actorId: string, action: string, subject: string, reason?: string, meta: Record<string, unknown> = {}) {
    this.audit.push({ seq: this.audit.length + 1, at: this.iso(), actorId, action, subject, reason, correlationId: this.correlationId, meta });
  }
  private enqueue(i: Omit<QueueItem, "queueItemId" | "createdAt" | "status">) {
    const id = uid("q");
    this.queue.set(id, { ...i, queueItemId: id, createdAt: this.iso(), status: "OPEN" });
    return id;
  }

  // ---- auth ----------------------------------------------------------
  /** Always answers identically so callers cannot enumerate registered numbers. */
  requestOtp(rawPhone: string, device = "unknown"): { sent: true } {
    const phone = normalizePhone(rawPhone);
    const now = this.now().getTime();
    for (const key of [`p:${phone}`, `d:${device}`]) {
      const recent = (this.otpRequests.get(key) ?? []).filter((t) => now - t < 3_600_000);
      if (recent.length >= this.cfg.otpMaxPerHour) throw new DomainError("RATE_LIMITED", 429, "Too many requests", "error.rate_limited");
      this.otpRequests.set(key, [...recent, now]);
    }
    const code = String(100000 + (randomBytes(4).readUInt32BE() % 900000));
    this.otps.set(phone, { hash: sha(`${phone}:${code}`), expires: now + this.cfg.otpTtlMs, attempts: 0, used: false });
    this.cfg.deliverOtp(phone, code);
    return { sent: true };
  }

  verifyOtp(rawPhone: string, code: string, device = "unknown"): { token: string; user: User } {
    const phone = normalizePhone(rawPhone);
    const rec = this.otps.get(phone);
    const bad = () => new DomainError("OTP_INVALID", 401, "The code is invalid or expired", "error.otp_invalid");
    if (!rec || rec.used || rec.expires < this.now().getTime() || rec.attempts >= 5) throw bad();
    rec.attempts++;
    if (!eq(rec.hash, sha(`${phone}:${code}`))) throw bad();
    rec.used = true;
    let user = this.users.get(this.phoneIndex.get(phone) ?? "");
    if (!user) {
      user = { userId: uid("user"), phone, displayName: "", actingAs: "INDEPENDENT", organizationIds: [], capabilities: this.cfg.operators[phone] ?? [], suspended: false, blocked: [], locale: "ta", createdAt: this.iso() };
      this.users.set(user.userId, user);
      this.phoneIndex.set(phone, user.userId);
      this.grantClaim(user.userId, "MOBILE_CONTROL", {});
    }
    if (user.suspended) throw forbidden("Account suspended");
    // rotate: revoke older sessions for the same device
    for (const s of this.sessions.values()) if (s.userId === user.userId && s.device === device) s.revoked = true;
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(sha(token), { token: sha(token), userId: user.userId, createdAt: this.iso(), stepUpUntil: 0, revoked: false, device });
    return { token, user };
  }

  authenticate(token: string | undefined): { user: User; session: Session } {
    const unauth = () => new DomainError("UNAUTHENTICATED", 401, "Authentication required", "error.unauthenticated");
    if (!token) throw unauth();
    const s = this.sessions.get(sha(token));
    const u = s && !s.revoked ? this.users.get(s.userId) : undefined;
    if (!s || !u) throw unauth();
    if (u.suspended) throw forbidden("Account suspended");
    return { user: u, session: s };
  }

  stepUp(session: Session, user: User, code: string) {
    // Step-up reuses OTP to the same phone.
    const rec = this.otps.get(user.phone);
    if (!rec || rec.used || rec.expires < this.now().getTime() || !eq(rec.hash, sha(`${user.phone}:${code}`))) throw new DomainError("OTP_INVALID", 401, "Invalid code", "error.otp_invalid");
    rec.used = true;
    session.stepUpUntil = this.now().getTime() + this.cfg.stepUpMs;
    this.log(user.userId, "AUTH_STEP_UP", user.userId);
  }

  listSessions(userId: string) { return [...this.sessions.values()].filter((s) => s.userId === userId && !s.revoked).map((s) => ({ device: s.device, createdAt: s.createdAt })); }
  revokeAllSessions(userId: string) { for (const s of this.sessions.values()) if (s.userId === userId) s.revoked = true; }

  /** Server-side capability check. Operator capabilities additionally require step-up. */
  require(user: User, session: Session | undefined, cap: Capability) {
    if (!user.capabilities.includes(cap)) throw forbidden();
    if (cap !== "price.contribute" && (!session || session.stepUpUntil < this.now().getTime())) throw new DomainError("STEP_UP_REQUIRED", 403, "Step-up authentication required");
  }

  updateProfile(user: User, patch: { displayName?: string; actingAs?: "INDEPENDENT" | "ORGANIZATION"; locale?: "en" | "ta" }) {
    Object.assign(user, patch);
    return user;
  }

  // ---- organizations & verification -----------------------------------
  createOrganization(user: User, name: string, kind: Organization["kind"]): Organization {
    const org: Organization = { organizationId: uid("org"), name, kind, members: [{ userId: user.userId, role: "OWNER" }] };
    this.orgs.set(org.organizationId, org);
    user.organizationIds.push(org.organizationId);
    this.log(user.userId, "ORG_CREATED", org.organizationId);
    return org;
  }
  addMember(actor: User, organizationId: string, userId: string, role: Organization["members"][number]["role"], session?: Session) {
    const org = this.orgs.get(organizationId) ?? (() => { throw notFound("Organization"); })();
    if (!org.members.some((m) => m.userId === actor.userId && m.role === "OWNER")) throw forbidden();
    if (role !== "MEMBER" && (!session || session.stepUpUntil < this.now().getTime())) throw new DomainError("STEP_UP_REQUIRED", 403, "Re-authentication required for high-risk membership change");
    const target = this.users.get(userId) ?? (() => { throw notFound("User"); })();
    org.members = org.members.filter((m) => m.userId !== userId).concat({ userId, role });
    if (!target.organizationIds.includes(organizationId)) target.organizationIds.push(organizationId);
    this.log(actor.userId, "ORG_MEMBER_CHANGED", organizationId, undefined, { userId, role });
    for (const m of org.members.filter((m) => m.role === "OWNER" && m.userId !== actor.userId)) this.notify(m.userId, "SMS", "org.member_changed", { organizationId, userId, role }, `member:${organizationId}:${userId}:${role}`);
    return org;
  }
  assertOrgMember(user: User, organizationId: string | undefined) {
    if (!organizationId) return;
    if (!this.orgs.get(organizationId)?.members.some((m) => m.userId === user.userId)) throw forbidden("Not a member of that organization");
  }

  private grantClaim(userId: string, type: ClaimType, scope: Record<string, string>, by = "system"): VerificationClaim {
    const c: VerificationClaim = { claimId: uid("claim"), userId, type, scope, status: "APPROVED", evidenceIds: [], verifiedAt: this.iso(), expiresAt: undefined, decidedBy: by, reasonCode: "AUTO" };
    this.claims.set(c.claimId, c);
    return c;
  }
  hasClaim(userId: string, type: ClaimType, scope?: Record<string, string>) {
    return [...this.claims.values()].some((c) => c.userId === userId && c.type === type && c.status === "APPROVED" && (!c.expiresAt || Date.parse(c.expiresAt) > this.now().getTime()) && (!scope || Object.entries(scope).every(([k, v]) => c.scope[k] === v)));
  }
  approvedClaimTypes(userId: string) { return [...new Set([...this.claims.values()].filter((c) => c.userId === userId && this.hasClaim(userId, c.type)).map((c) => c.type))]; }

  submitClaim(user: User, type: ClaimType, scope: Record<string, string>, evidenceNotes: string[]): VerificationClaim {
    if (type === "MOBILE_CONTROL") throw invalid("CLAIM_AUTOMATIC", "Mobile claim is granted at login");
    const ids = evidenceNotes.map((n) => {
      const e: Evidence = { evidenceId: uid("ev"), ownerId: user.userId, dealId: undefined, kind: "VERIFICATION_DOCUMENT", visibleTo: [user.userId], note: n, at: this.iso(), sensitive: true };
      this.evidence.set(e.evidenceId, e);
      return e.evidenceId;
    });
    const c: VerificationClaim = { claimId: uid("claim"), userId: user.userId, type, scope, status: "SUBMITTED", evidenceIds: ids, verifiedAt: undefined, expiresAt: undefined, decidedBy: undefined, reasonCode: undefined };
    this.claims.set(c.claimId, c);
    this.enqueue({ queue: "VERIFICATION", subject: c.claimId, summary: `${type} claim submitted`, reasons: [type], priority: 2, requiredCapability: "ops.verification" });
    return c;
  }

  decideClaim(op: User, session: Session, claimId: string, decision: "APPROVED" | "REJECTED" | "NEEDS_MORE_INFORMATION" | "REVOKED", reasonCode: string, expiresAt?: string) {
    this.require(op, session, "ops.verification");
    if (!reasonCode) throw invalid("REASON_REQUIRED", "A reason code is required");
    const c = this.claims.get(claimId) ?? (() => { throw notFound("Claim"); })();
    if (c.userId === op.userId) throw forbidden("Conflict of interest: cannot decide own claim");
    if (decision === "REVOKED" ? c.status !== "APPROVED" : !["SUBMITTED", "IN_REVIEW", "NEEDS_MORE_INFORMATION"].includes(c.status)) throw conflict("INVALID_CLAIM_TRANSITION", `Claim is ${c.status}`);
    c.status = decision;
    c.decidedBy = op.userId;
    c.reasonCode = reasonCode;
    if (decision === "APPROVED") { c.verifiedAt = this.iso(); c.expiresAt = expiresAt; }
    for (const q of this.queue.values()) if (q.subject === claimId) q.status = "DONE";
    // revocation invalidates dependent permissions
    if (decision === "REVOKED" && c.type === "PRICE_CONTRIBUTOR_SCOPE") {
      const u = this.users.get(c.userId);
      if (u && !this.hasClaim(u.userId, "PRICE_CONTRIBUTOR_SCOPE")) u.capabilities = u.capabilities.filter((x) => x !== "price.contribute");
    }
    if (decision === "APPROVED" && c.type === "PRICE_CONTRIBUTOR_SCOPE") {
      const u = this.users.get(c.userId);
      if (u && !u.capabilities.includes("price.contribute")) u.capabilities.push("price.contribute");
    }
    this.notify(c.userId, "SMS", `claim.${decision.toLowerCase()}`, { type: c.type }, `claim:${claimId}:${decision}`);
    this.log(op.userId, "CLAIM_DECIDED", claimId, reasonCode, { decision });
    return c;
  }

  /** Public summary never includes evidence documents. */
  claimSummaries(userId: string, locale: "en" | "ta" = "en") {
    return [...this.claims.values()].filter((c) => c.userId === userId && c.status === "APPROVED").map((c) => ({ type: c.type, status: c.status, verifiedAt: c.verifiedAt, expiresAt: c.expiresAt ?? null, scope: c.scope, displayLabelKey: `claim.${c.type}`, locale }));
  }

  accessEvidence(user: User, session: Session | undefined, evidenceId: string): Evidence {
    const e = this.evidence.get(evidenceId) ?? (() => { throw notFound("Evidence"); })();
    if (e.visibleTo.includes(user.userId)) return e;
    if (e.sensitive) {
      if (!user.capabilities.includes("ops.sensitive_documents")) throw notFound("Evidence");
      this.require(user, session, "ops.sensitive_documents");
      this.log(user.userId, "SENSITIVE_EVIDENCE_ACCESSED", evidenceId);
      return e;
    }
    throw notFound("Evidence");
  }

  // ---- notifications --------------------------------------------------
  notify(userId: string, channel: string, template: string, data: Record<string, unknown>, dedupeKey: string) {
    if (this.notifications.some((n) => n.userId === userId && n.dedupeKey === dedupeKey)) return false;
    this.notifications.push({ notificationId: uid("n"), userId, channel, template, data, dedupeKey, at: this.iso() });
    return true;
  }

  // ---- idempotency ----------------------------------------------------
  idempotent<T>(actorId: string, endpoint: string, key: string | undefined, payload: unknown, fn: () => T): T {
    if (!key) throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key header required");
    const k = `${actorId}|${endpoint}|${key}`;
    const hash = sha(JSON.stringify(payload ?? null));
    const prev = this.idempotency.get(k);
    if (prev) {
      if (prev.hash !== hash) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with a different payload");
      return prev.result as T;
    }
    const result = fn();
    this.idempotency.set(k, { hash, result });
    return result;
  }

  // ---- price intelligence --------------------------------------------
  private health(source: string): SourceHealthRecord {
    let h = this.sourceHealth.get(source);
    if (!h) {
      h = { source, lastAttemptAt: undefined, lastSuccessAt: undefined, lastError: undefined, lastObservationAt: undefined, retrieved: 0, normalized: 0, unmapped: 0, rejected: 0, disabled: false, consecutiveFailures: 0 };
      this.sourceHealth.set(source, h);
    }
    return h;
  }
  recordSourceFailure(source: string, error: string) {
    const h = this.health(source);
    h.lastAttemptAt = this.iso();
    h.lastError = error.replace(/api-key=[^&\s]+/gi, "api-key=[REDACTED]");
    h.consecutiveFailures++;
  }
  sourceStatus(source: string): "HEALTHY" | "DELAYED" | "STALE" | "DEGRADED" | "DISABLED" {
    const h = this.health(source);
    if (h.disabled) return "DISABLED";
    if (h.consecutiveFailures >= 3) return "DEGRADED";
    const last = h.lastSuccessAt ? this.now().getTime() - Date.parse(h.lastSuccessAt) : Infinity;
    if (last > 72 * 3_600_000) return "STALE";
    if (last > 26 * 3_600_000 || h.consecutiveFailures > 0) return "DELAYED";
    return "HEALTHY";
  }
  listSourceHealth(op: User, session: Session) {
    this.require(op, session, "ops.source_health");
    return ["agmarknet", "contributors"].map((s) => ({ ...this.health(s), status: this.sourceStatus(s) }));
  }

  /** Idempotent: raw payload is stored before parsing and re-ingestion never refreshes observation time. */
  ingestRaw(source: string, records: Record<string, unknown>[], parserVersion = "agmarknet-v1"): { stored: number; duplicates: number; observations: number; unmapped: number } {
    const h = this.health(source);
    h.lastAttemptAt = this.iso();
    let stored = 0, duplicates = 0, observations = 0, unmapped = 0;
    for (const payload of records) {
      const hash = sha(JSON.stringify(payload, Object.keys(payload).sort()));
      if ([...this.raw.values()].some((r) => r.source === source && r.hash === hash)) { duplicates++; continue; }
      const rec: RawRecord = { rawId: uid("raw"), source, hash, payload, receivedAt: this.iso(), parserVersion, parsed: false, unmapped: [] };
      this.raw.set(rec.rawId, rec); // raw first, parse after
      stored++;
      h.retrieved++;
      const result = this.normalizeAgmarknet(rec);
      if (result === "OBSERVATION") { observations++; h.normalized++; }
      else { unmapped++; h.unmapped++; }
    }
    h.lastSuccessAt = this.iso();
    h.lastError = undefined;
    h.consecutiveFailures = 0;
    return { stored, duplicates, observations, unmapped };
  }

  private normalizeAgmarknet(rec: RawRecord): "OBSERVATION" | "UNMAPPED" {
    const p = rec.payload;
    const s = (k: string) => String(p[k] ?? "").trim();
    const issues: string[] = [];
    const commodity = SOURCE_COMMODITY_MAP[s("commodity").toLowerCase()];
    const marketId = SOURCE_MARKET_MAP[s("market").toLowerCase()];
    const unit = SOURCE_UNIT_MAP[(s("price_unit") || "Rs./Quintal").toLowerCase()];
    if (!commodity) issues.push(`commodity:${s("commodity")}`);
    if (!marketId) issues.push(`market:${s("market")}`);
    if (!unit) issues.push(`unit:${s("price_unit")}`);
    // dd/mm/yyyy or ISO source date: this is the observation date, not retrieval time
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s("arrival_date"));
    const observedAt = m ? new Date(Date.UTC(+(m[3] as string), +(m[2] as string) - 1, +(m[1] as string), 4, 30)).toISOString() : /^\d{4}-\d{2}-\d{2}/.test(s("arrival_date")) ? new Date(s("arrival_date")).toISOString() : "";
    if (!observedAt) issues.push("date");
    const rupees = (k: string) => (/^\d+(\.\d+)?$/.test(s(k)) ? Math.round(Number(s(k)) * 100) : NaN);
    const low = rupees("min_price"), high = rupees("max_price"), modal = rupees("modal_price");
    if ([low, high, modal].some(Number.isNaN)) issues.push("price");
    if (issues.length || !commodity || !marketId || !unit) {
      rec.unmapped = issues;
      rec.parsed = true;
      this.enqueue({ queue: "MAPPING", subject: rec.rawId, summary: `Unmapped source record: ${issues.join(", ")}`, reasons: issues, priority: 3, requiredCapability: "ops.price_review" });
      return "UNMAPPED";
    }
    rec.parsed = true;
    const obs: PriceObservation = {
      observationId: uid("obs"), sourceClass: "OFFICIAL_MARKET", organizationId: `src_${rec.source}`, productId: commodity, gradeGroup: s("grade") || "FAQ",
      marketId, unit, stage: "REGULATED_MARKET", tradeTerm: "AT_MARKET", lowPaise: low, highPaise: high, referencePaise: modal, observedAt,
      quantity: undefined, expiresAt: undefined, state: "RECEIVED", version: 1, supersedes: undefined,
    };
    this.processObservation(obs, rec.rawId);
    return "OBSERVATION";
  }

  /** RECEIVED → NORMALIZED → (ELIGIBLE | NEEDS_REVIEW | REJECTED). */
  private processObservation(o: PriceObservation, ref: string): PriceObservation {
    this.observations.set(o.observationId, o);
    const h = this.health(o.sourceClass === "OFFICIAL_MARKET" ? "agmarknet" : "contributors");
    const issues = validateObservation(o, this.now());
    if (issues.length) {
      this.setObs(transitionObservation(o, "REJECTED"));
      h.rejected++;
      this.log("system", "OBSERVATION_REJECTED", o.observationId, issues.map((i) => i.code).join(","), { ref });
      return this.observations.get(o.observationId) as PriceObservation;
    }
    let cur = transitionObservation(o, "NORMALIZED");
    const sameBucket = [...this.observations.values()].filter((x) => x.observationId !== o.observationId && bucketKey(x) === bucketKey(o) && ["ELIGIBLE", "PUBLISHED"].includes(x.state));
    const refOf = (x: PriceObservation) => x.referencePaise ?? Math.round((x.lowPaise + x.highPaise) / 2);
    const signals = detectAnomalies(o, {
      history: sameBucket.filter((x) => Date.parse(x.observedAt) < Date.parse(o.observedAt)).map(refOf),
      peers: sameBucket.filter((x) => x.organizationId !== o.organizationId && Math.abs(Date.parse(x.observedAt) - Date.parse(o.observedAt)) < 36 * 3_600_000).map(refOf),
      ownRecentReferences: sameBucket.filter((x) => x.organizationId === o.organizationId).map(refOf),
    });
    if (signals.length) {
      cur = transitionObservation(cur, "NEEDS_REVIEW");
      this.enqueue({ queue: "PRICE_REVIEW", subject: o.observationId, summary: `Anomaly in ${o.productId} @ ${o.marketId}`, reasons: signals.map((s) => s.code), priority: signals.some((s) => s.code === "POSSIBLE_UNIT_ERROR") ? 1 : 2, requiredCapability: "ops.price_review" });
    } else cur = transitionObservation(cur, "ELIGIBLE");
    this.setObs(cur);
    return cur;
  }
  private setObs(o: PriceObservation) { this.observations.set(o.observationId, o); }

  submitQuote(user: User, input: { productId: ProductId; marketId: string; gradeGroup: string; unit: Unit; stage: MarketStage; tradeTerm: TradeTerm; lowPaise: number; highPaise: number; referencePaise?: number; observedAt: string; quantity?: string; expiresAt?: string; executable?: boolean; organizationId: string; costsIncluded?: string[]; note?: string }) {
    if (!user.capabilities.includes("price.contribute")) throw forbidden("Not an approved price contributor");
    if (!this.hasClaim(user.userId, "PRICE_CONTRIBUTOR_SCOPE")) throw forbidden("Contributor approval has been revoked");
    const scoped = [...this.claims.values()].some((c) => c.userId === user.userId && c.type === "PRICE_CONTRIBUTOR_SCOPE" && c.status === "APPROVED" && (c.scope.marketId ?? input.marketId) === input.marketId && (c.scope.productId ?? input.productId) === input.productId);
    if (!scoped) throw forbidden("Outside approved contributor scope");
    this.assertOrgMember(user, input.organizationId);
    const o: PriceObservation = {
      observationId: uid("obs"), sourceClass: input.executable ? "VERIFIED_QUOTE" : "VERIFIED_QUOTE", organizationId: input.organizationId, productId: input.productId,
      gradeGroup: input.gradeGroup, marketId: input.marketId, unit: input.unit, stage: input.stage, tradeTerm: input.tradeTerm, lowPaise: input.lowPaise, highPaise: input.highPaise,
      referencePaise: input.referencePaise, observedAt: input.observedAt, quantity: input.quantity, expiresAt: input.expiresAt, state: "RECEIVED", version: 1, supersedes: undefined,
    };
    const h = this.health("contributors");
    h.lastAttemptAt = this.iso(); h.lastSuccessAt = this.iso(); h.retrieved++;
    const res = this.processObservation(o, `quote:${user.userId}`);
    if (res.state === "REJECTED") {
      const issues = validateObservation(o, this.now());
      throw invalid("OBSERVATION_INVALID", issues.map((i) => i.code).join(", "));
    }
    h.normalized++;
    this.log(user.userId, "QUOTE_SUBMITTED", o.observationId);
    return res;
  }

  /** Operators resolve anomaly reviews; contributors cannot approve their own. */
  reviewObservation(op: User, session: Session, observationId: string, decision: "APPROVE" | "REJECT", reason: string) {
    this.require(op, session, "ops.price_review");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const o = this.observations.get(observationId) ?? (() => { throw notFound("Observation"); })();
    if (o.state !== "NEEDS_REVIEW") throw conflict("INVALID_TRANSITION", `Observation is ${o.state}`);
    this.setObs(transitionObservation(o, decision === "APPROVE" ? "ELIGIBLE" : "REJECTED"));
    for (const q of this.queue.values()) if (q.subject === observationId) q.status = "DONE";
    this.log(op.userId, `OBSERVATION_${decision}D`, observationId, reason);
    return this.observations.get(observationId) as PriceObservation;
  }

  resolveMapping(op: User, session: Session, queueItemId: string, mapping: { productId: ProductId; marketId: string; unit: Unit; stage?: MarketStage }, reason: string) {
    this.require(op, session, "ops.price_review");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const q = this.queue.get(queueItemId);
    const rec = q && this.raw.get(q.subject);
    if (!q || !rec || q.queue !== "MAPPING") throw notFound("Mapping item");
    const p = rec.payload;
    const rupees = (k: string) => Math.round(Number(p[k]) * 100);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(p.arrival_date));
    if (!m) throw invalid("INVALID_DATE", "Source record has no parseable date");
    const o: PriceObservation = { observationId: uid("obs"), sourceClass: "OFFICIAL_MARKET", organizationId: `src_${rec.source}`, productId: mapping.productId, gradeGroup: String(p.grade ?? "FAQ"), marketId: mapping.marketId, unit: mapping.unit, stage: mapping.stage ?? "REGULATED_MARKET", tradeTerm: "AT_MARKET", lowPaise: rupees("min_price"), highPaise: rupees("max_price"), referencePaise: rupees("modal_price"), observedAt: new Date(Date.UTC(+(m[3] as string), +(m[2] as string) - 1, +(m[1] as string), 4, 30)).toISOString(), quantity: undefined, expiresAt: undefined, state: "RECEIVED", version: 1, supersedes: undefined };
    q.status = "DONE";
    this.log(op.userId, "MAPPING_RESOLVED", rec.rawId, reason);
    return this.processObservation(o, rec.rawId);
  }

  /** Corrections never mutate the raw record or the old observation's values: they supersede it. */
  correctObservation(actor: User, session: Session | undefined, observationId: string, fix: { lowPaise: number; highPaise: number; referencePaise?: number }, reason: string) {
    const old = this.observations.get(observationId) ?? (() => { throw notFound("Observation"); })();
    const isOwner = old.sourceClass === "VERIFIED_QUOTE" && actor.organizationIds.includes(old.organizationId);
    if (!isOwner) this.require(actor, session, "ops.price_review");
    if (!reason) throw invalid("REASON_REQUIRED", "A correction reason is required");
    if (!["ELIGIBLE", "PUBLISHED"].includes(old.state)) throw conflict("INVALID_TRANSITION", `Observation is ${old.state}`);
    const replacement: PriceObservation = { ...old, observationId: uid("obs"), ...fix, referencePaise: fix.referencePaise, state: "RECEIVED", version: old.version + 1, supersedes: old.observationId };
    this.setObs({ ...old, state: old.state === "ELIGIBLE" ? "REJECTED" : "SUPERSEDED" });
    const res = this.processObservation(replacement, `correction:${old.observationId}`);
    this.log(actor.userId, "OBSERVATION_CORRECTED", old.observationId, reason, { replacement: res.observationId });
    const affected = this.refreshAggregates();
    return { replacement: res, republished: affected };
  }

  /** Recompute all published buckets; idempotent for unchanged inputs. */
  refreshAggregates(): number {
    const targets = new Map<string, Parameters<typeof aggregate>[1]>();
    for (const o of this.observations.values()) {
      if (o.sourceClass === "MSP_REFERENCE" || !["ELIGIBLE", "PUBLISHED"].includes(o.state)) continue;
      for (const marketId of o.sourceClass === "OFFICIAL_MARKET" || true ? [o.marketId] : []) {
        const t = { productId: o.productId, marketId, unit: o.unit, stage: o.stage, tradeTerm: o.tradeTerm, gradeGroup: o.gradeGroup };
        targets.set(bucketKey(t), t);
      }
    }
    let changed = 0;
    for (const [key, t] of targets) {
      const res = aggregate([...this.observations.values()], t, this.now());
      const hist = this.aggregates.get(key) ?? [];
      if (res.kind === "AGGREGATE") {
        const prev = hist[hist.length - 1];
        const same = prev && prev.referencePaise === res.aggregate.referencePaise && prev.lowPaise === res.aggregate.lowPaise && prev.highPaise === res.aggregate.highPaise && prev.contributingObservationIds.join() === res.aggregate.contributingObservationIds.join();
        if (!same) { hist.push(res.aggregate); this.aggregates.set(key, hist); changed++; }
        for (const id of res.aggregate.contributingObservationIds) { const o = this.observations.get(id); if (o?.state === "ELIGIBLE") this.setObs(transitionObservation(o, "PUBLISHED")); }
      }
    }
    return changed;
  }

  private latestAggregate(key: string) { const h = this.aggregates.get(key); return h?.[h.length - 1]; }

  /** Public view: aggregates where evidence rules hold, otherwise latest official observation; stale data is labelled. */
  latestPrices(filter: { productId?: string; marketId?: string; stage?: string; unit?: string; gradeGroup?: string } = {}) {
    const now = this.now();
    const items: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const [key, hist] of this.aggregates) {
      const a = hist[hist.length - 1] as Aggregate;
      seen.add(key);
      if (!this.matchesFilter(a, filter)) continue;
      const stillValid = aggregate([...this.observations.values()], a, now);
      const fresh = freshness(a.observedWindow.endsAt, now);
      if (stillValid.kind !== "AGGREGATE") {
        // Source failure or expiry changes freshness/state; last known value is kept but labelled.
        items.push(this.renderAggregate(a, "STALE", "LOW"));
        continue;
      }
      items.push(this.renderAggregate(stillValid.aggregate, fresh, effectiveConfidence(stillValid.aggregate, now)));
    }
    // Official observations in buckets lacking sufficient evidence
    const officials = new Map<string, PriceObservation>();
    for (const o of this.observations.values()) {
      if (o.sourceClass !== "OFFICIAL_MARKET" || !["ELIGIBLE", "PUBLISHED"].includes(o.state) || seen.has(bucketKey(o))) continue;
      const k = bucketKey(o);
      const cur = officials.get(k);
      if (!cur || Date.parse(o.observedAt) > Date.parse(cur.observedAt)) officials.set(k, o);
    }
    for (const o of officials.values()) {
      if (!this.matchesFilter(o, filter)) continue;
      items.push({
        priceAggregateId: null, kind: "OFFICIAL_OBSERVATION_ONLY", product: this.productRef(o.productId), market: this.marketRef(o.marketId), stage: o.stage, tradeTerm: o.tradeTerm, gradeGroup: o.gradeGroup,
        range: this.rangeOf(o.lowPaise, o.referencePaise ?? Math.round((o.lowPaise + o.highPaise) / 2), o.highPaise, o.unit),
        observedWindow: { startsAt: o.observedAt, endsAt: o.observedAt }, freshness: freshness(o.observedAt, now), confidence: "LOW", messageKey: "price.insufficient",
        evidenceSummary: { observations: 1, independentOrganizations: 1, officialMarketObservations: 1, verifiedQuotes: 0, completedTrades: 0 }, calculationVersion: null,
        disclaimerKey: "price.not_offer",
      });
    }
    return items.sort((a, b) => String((a.product as { productId: string }).productId).localeCompare(String((b.product as { productId: string }).productId)) || String((a.market as { marketId: string }).marketId).localeCompare(String((b.market as { marketId: string }).marketId)));
  }
  private matchesFilter(o: { productId: string; marketId: string; stage: string; unit: string; gradeGroup: string }, f: { productId?: string; marketId?: string; stage?: string; unit?: string; gradeGroup?: string }) {
    return (!f.productId || o.productId === f.productId) && (!f.marketId || o.marketId === f.marketId || MARKETS[o.marketId]?.areaId === f.marketId) && (!f.stage || o.stage === f.stage) && (!f.unit || o.unit === f.unit) && (!f.gradeGroup || o.gradeGroup === f.gradeGroup);
  }
  private productRef(id: ProductId) { return { productId: id, name: PRODUCTS[id].name.en, nameTa: PRODUCTS[id].name.ta }; }
  private marketRef(id: string) { const m = MARKETS[id]; return { marketId: id, name: m?.name.en ?? id, nameTa: m?.name.ta ?? id }; }
  private rangeOf(low: number, ref: number, high: number, unit: Unit) {
    const m = (n: number) => ({ amountPaise: n, currency: "INR" });
    return { low: m(low), reference: m(ref), high: m(high), perUnit: unit };
  }
  private renderAggregate(a: Aggregate, fresh: string, confidence: string) {
    const msg = confidence === "LOW" ? "price.limited_evidence" : null;
    return {
      priceAggregateId: `pa_${sha(a.bucket + a.calculatedAt).slice(0, 12)}`, kind: "AGGREGATE", product: this.productRef(a.productId), market: this.marketRef(a.marketId), stage: a.stage, tradeTerm: a.tradeTerm, gradeGroup: a.gradeGroup,
      range: this.rangeOf(a.lowPaise, a.referencePaise, a.highPaise, a.unit), observedWindow: a.observedWindow, freshness: fresh, confidence, messageKey: fresh === "STALE" ? "price.stale" : msg,
      evidenceSummary: a.evidenceSummary, calculationVersion: a.calculationVersion, disclaimerKey: "price.not_offer",
    };
  }

  /** Summarised, contributor-anonymous evidence for one bucket. */
  priceEvidence(productId: string, marketId: string, unit: string, stage: string) {
    const key = [...this.aggregates.keys()].find((k) => k.startsWith(`${productId}|`) && k.includes(`|${unit}|${stage}|`) && k.includes(`|${marketId}|`));
    const a = key ? this.latestAggregate(key) : undefined;
    if (!a) throw notFound("Price");
    return {
      bucket: a.bucket, calculationVersion: a.calculationVersion, calculatedAt: a.calculatedAt, evidenceSummary: a.evidenceSummary,
      observations: a.contributingObservationIds.map((id) => {
        const o = this.observations.get(id) as PriceObservation;
        return { sourceClass: o.sourceClass, observedAt: o.observedAt, range: this.rangeOf(o.lowPaise, o.referencePaise ?? o.lowPaise, o.highPaise, o.unit) }; // no contributor identity
      }),
    };
  }
  priceHistory(productId: string, marketId: string, unit: string, stage: string) {
    const out: Aggregate[] = [];
    for (const [k, h] of this.aggregates) if (k.startsWith(`${productId}|`) && k.includes(`|${unit}|${stage}|`) && k.includes(`|${marketId}|`)) out.push(...h);
    return out.sort((x, y) => x.calculatedAt.localeCompare(y.calculatedAt)).map((a) => ({ calculatedAt: a.calculatedAt, range: this.rangeOf(a.lowPaise, a.referencePaise, a.highPaise, a.unit), confidence: a.confidence, observedWindow: a.observedWindow, calculationVersion: a.calculationVersion }));
  }
  /** Reproduce a historical aggregate from its stored inputs. */
  reproduceAggregate(a: Aggregate): AggregateResult {
    const inputs = a.contributingObservationIds.map((id) => this.observations.get(id) as PriceObservation);
    return aggregate(inputs, a, new Date(a.calculatedAt));
  }
  mspReferences() { return this.msp.map((m) => ({ ...m, noteKey: "price.msp_note" })); }

  // ---- alerts --------------------------------------------------------
  createAlert(user: User, input: { productId: ProductId; marketId: string; unit: Unit; stage: MarketStage; direction: "ABOVE" | "BELOW" | "BULLETIN"; thresholdPaise?: number; channel: "SMS" | "WHATSAPP" | "PUSH"; consent: boolean }): AlertSubscription {
    if (!input.consent) throw invalid("CONSENT_REQUIRED", "Consent to receive alerts is required");
    if (input.direction !== "BULLETIN" && !input.thresholdPaise) throw invalid("THRESHOLD_REQUIRED", "Threshold required");
    const a: AlertSubscription = { alertId: uid("alert"), userId: user.userId, productId: input.productId, marketId: input.marketId, unit: input.unit, stage: input.stage, direction: input.direction, thresholdPaise: input.thresholdPaise, channel: input.channel, consentAt: this.iso(), status: "ACTIVE", lastTriggeredKey: undefined };
    this.alerts.set(a.alertId, a);
    return a;
  }
  setAlertStatus(user: User, alertId: string, status: "ACTIVE" | "PAUSED" | "CANCELLED") {
    const a = this.alerts.get(alertId);
    if (!a || a.userId !== user.userId) throw notFound("Alert");
    if (a.status === "CANCELLED") throw conflict("ALERT_CANCELLED", "Alert is cancelled");
    a.status = status;
    return a;
  }
  /** Idempotent evaluation: crossing is keyed by aggregate observation window so repeats never spam. */
  evaluateAlerts(): number {
    let sent = 0;
    for (const a of this.alerts.values()) {
      if (a.status !== "ACTIVE") continue;
      const price = (this.latestPrices({ productId: a.productId, marketId: a.marketId, unit: a.unit, stage: a.stage })[0] ?? undefined) as { range: { reference: { amountPaise: number } }; observedWindow: { endsAt: string }; freshness: string } | undefined;
      if (!price || price.freshness === "STALE") continue;
      const ref = price.range.reference.amountPaise;
      const hit = a.direction === "BULLETIN" || (a.direction === "ABOVE" ? ref >= (a.thresholdPaise as number) : ref <= (a.thresholdPaise as number));
      if (!hit) { a.lastTriggeredKey = undefined; continue; } // re-arm once the price leaves the threshold zone
      const key = a.direction === "BULLETIN" ? `bulletin:${a.alertId}:${price.observedWindow.endsAt.slice(0, 10)}` : `threshold:${a.alertId}`;
      if (a.lastTriggeredKey === key) continue;
      if (this.notify(a.userId, a.channel, "price.alert", { alertId: a.alertId, referencePaise: ref, observedAt: price.observedWindow.endsAt, link: `/prices/${a.productId}/${a.marketId}` }, `${key}:${price.observedWindow.endsAt}`)) { sent++; a.lastTriggeredKey = key; }
    }
    return sent;
  }

  // ---- participants / helpers ----------------------------------------
  private participant(userId: string): ParticipantState {
    const u = this.users.get(userId);
    const claims = this.approvedClaimTypes(userId);
    const completed = this.reputation.filter((e) => e.partyId === userId && e.type === "DEAL_COMPLETED").length;
    return { active: !!u, suspended: u?.suspended ?? true, blocked: u?.blocked ?? [], claims, completedDeals: completed };
  }
  private lotLocation(l: SellLot) { return l.preciseLocation ?? (MARKETS[l.originMarketId] as { lat: number; lon: number }); }
  private isVerifiedParty(userId: string) { return this.hasClaim(userId, "PERSON_IDENTITY") || this.hasClaim(userId, "ORGANIZATION_EXISTENCE"); }
  private getLot(id: string) { return this.lots.get(id) ?? (() => { throw notFound("Sell lot"); })(); }
  private getReq(id: string) { return this.requirements.get(id) ?? (() => { throw notFound("Requirement"); })(); }
  private getOffer(id: string) { return this.offers.get(id) ?? (() => { throw notFound("Offer"); })(); }
  private getDeal(id: string) { return this.deals.get(id) ?? (() => { throw notFound("Deal"); })(); }
  private expectVersion(actual: number, expected: number | undefined) {
    if (expected !== undefined && expected !== actual) throw conflict("VERSION_CONFLICT", "The resource was changed by someone else");
  }

  // ---- sell lots -----------------------------------------------------
  createLot(user: User, input: { organizationId?: string; listedOnBehalfOf?: string; productId: ProductId; gradeAttributes: Record<string, string>; gradeGroup: string; unit: Unit; quantityTotal: string; partialFulfilmentAllowed: boolean; originMarketId: string; preciseLocation?: { lat: number; lon: number }; availableFrom: string; availableTo: string; expiresAt: string; fulfilment: FulfilmentTerm; priceExpectation: SellLot["priceExpectation"]; photoCount?: number }): SellLot {
    this.assertOrgMember(user, input.organizationId);
    if (!MARKETS[input.originMarketId]) throw invalid("UNKNOWN_MARKET", "Unknown origin market");
    toMilli(input.quantityTotal);
    const lot: SellLot = { sellLotId: uid("lot"), sellerId: user.userId, organizationId: input.organizationId, listedOnBehalfOf: input.listedOnBehalfOf, productId: input.productId, gradeAttributes: input.gradeAttributes, gradeGroup: input.gradeGroup, unit: input.unit, quantityTotal: input.quantityTotal, quantityReserved: "0", partialFulfilmentAllowed: input.partialFulfilmentAllowed, originMarketId: input.originMarketId, preciseLocation: input.preciseLocation, availableFrom: input.availableFrom, availableTo: input.availableTo, expiresAt: input.expiresAt, fulfilment: input.fulfilment, priceExpectation: input.priceExpectation, photoCount: input.photoCount ?? 0, photoExceptionReason: undefined, status: "DRAFT", version: 1, createdAt: this.iso() };
    this.lots.set(lot.sellLotId, lot);
    return lot;
  }
  private ownLot(user: User, id: string) {
    const l = this.getLot(id);
    if (l.sellerId !== user.userId && !(l.organizationId && this.orgs.get(l.organizationId)?.members.some((m) => m.userId === user.userId))) throw notFound("Sell lot");
    return l;
  }
  addLotPhoto(user: User, lotId: string) { const l = this.ownLot(user, lotId); l.photoCount++; l.version++; return l; }
  grantPhotoException(op: User, session: Session, lotId: string, reason: string) {
    this.require(op, session, "ops.listings");
    if (!reason) throw invalid("REASON_REQUIRED", "A justification is required");
    const l = this.getLot(lotId); l.photoExceptionReason = reason; l.version++;
    this.log(op.userId, "PHOTO_EXCEPTION", lotId, reason);
    return l;
  }
  getLotForOwner(user: User, id: string) { return this.ownLot(user, id); }

  updateLot(user: User, lotId: string, patch: Partial<Pick<SellLot, "gradeAttributes" | "quantityTotal" | "expiresAt" | "availableFrom" | "availableTo" | "fulfilment" | "priceExpectation" | "partialFulfilmentAllowed" | "gradeGroup">>, expectedVersion?: number) {
    const l = this.ownLot(user, lotId);
    this.expectVersion(l.version, expectedVersion);
    if (["SOLD", "EXPIRED", "WITHDRAWN", "SUSPENDED"].includes(l.status)) throw conflict("LOT_NOT_EDITABLE", `Lot is ${l.status}`);
    if (patch.quantityTotal !== undefined && compareQuantity(patch.quantityTotal, l.quantityReserved) < 0) throw invalid("BELOW_RESERVED", "Quantity cannot be below the reserved amount");
    const material = isMaterialLotChange(patch) && Object.entries(patch).some(([k, v]) => JSON.stringify((l as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v));
    Object.assign(l, patch);
    l.version++;
    if (material) {
      for (const o of this.offers.values()) if (o.sellLotId === lotId && o.status === "ACTIVE") { o.status = "INVALIDATED"; o.version++; this.notify(o.buyerId, "SMS", "offer.invalidated", { offerId: o.offerId }, `inv:${o.offerId}`); }
      this.log(user.userId, "LOT_REVISED", lotId, undefined, { version: l.version });
    }
    return { lot: l, materialRevision: material };
  }
  activateLot(user: User, lotId: string): SellLot {
    const l = this.ownLot(user, lotId);
    const issues = validateLotForActivation(l, this.now());
    if (issues.length) throw invalid("LOT_INVALID", issues.join(", "));
    if (!this.hasClaim(user.userId, "PERSON_IDENTITY") && !this.hasClaim(user.userId, "ORGANIZATION_EXISTENCE") && this.participant(user.userId).completedDeals === 0) {
      assertLotTransition(l.status, "PENDING_REVIEW");
      l.status = "PENDING_REVIEW"; l.version++;
      this.enqueue({ queue: "LISTING_REVIEW", subject: l.sellLotId, summary: "New participant listing", reasons: ["NEW_PARTICIPANT"], priority: 2, requiredCapability: "ops.listings" });
      return l;
    }
    assertLotTransition(l.status, "ACTIVE");
    l.status = "ACTIVE"; l.version++;
    return l;
  }
  reviewListing(op: User, session: Session, lotId: string, decision: "APPROVE" | "SUSPEND" | "RETURN", reason: string) {
    this.require(op, session, "ops.listings");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const l = this.getLot(lotId);
    const to = decision === "APPROVE" ? "ACTIVE" : decision === "SUSPEND" ? "SUSPENDED" : "DRAFT";
    assertLotTransition(l.status, to);
    l.status = to; l.version++;
    for (const q of this.queue.values()) if (q.subject === lotId) q.status = "DONE";
    this.log(op.userId, `LISTING_${decision}`, lotId, reason);
    return l;
  }
  withdrawLot(user: User, lotId: string) {
    const l = this.ownLot(user, lotId);
    if (toMilli(l.quantityReserved) > 0n) throw conflict("LOT_RESERVED", "A reserved lot cannot be withdrawn");
    assertLotTransition(l.status, "WITHDRAWN");
    l.status = "WITHDRAWN"; l.version++;
    for (const o of this.offers.values()) if (o.sellLotId === lotId && o.status === "ACTIVE") { o.status = "INVALIDATED"; o.version++; }
    return l;
  }
  searchLots(f: { productId?: string; originMarketId?: string; gradeGroup?: string; sort?: "NEWEST" | "BEST_MATCH" } = {}) {
    return [...this.lots.values()]
      .filter((l) => (l.status === "ACTIVE" || l.status === "RESERVED") && Date.parse(l.expiresAt) > this.now().getTime() && (!f.productId || l.productId === f.productId) && (!f.originMarketId || l.originMarketId === f.originMarketId) && (!f.gradeGroup || l.gradeGroup === f.gradeGroup) && !this.users.get(l.sellerId)?.suspended)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.sellLotId.localeCompare(b.sellLotId))
      .map((l) => ({ ...publicLotView(l), verificationClaims: this.claimSummaries(l.sellerId).map((c) => ({ type: c.type, displayLabelKey: c.displayLabelKey })) }));
  }

  /** Time-based expiry for lots, requirements and offers; safe to re-run. */
  runExpiry(): { lots: number; requirements: number; offers: number; deemedAcceptances: number } {
    const now = this.now().getTime();
    let lots = 0, reqs = 0, offers = 0, deemed = 0;
    for (const l of this.lots.values()) if (["ACTIVE", "DRAFT", "PENDING_REVIEW"].includes(l.status) && Date.parse(l.expiresAt) <= now && l.status === "ACTIVE") { l.status = "EXPIRED"; l.version++; lots++; }
    for (const r of this.requirements.values()) if (r.status === "ACTIVE" && Date.parse(r.expiresAt) <= now) { r.status = "EXPIRED"; r.version++; reqs++; }
    for (const o of this.offers.values()) if (o.status === "ACTIVE" && Date.parse(o.expiresAt) <= now) { o.status = "EXPIRED"; o.version++; offers++; }
    for (const d of this.deals.values()) {
      const card = currentCard(d);
      if (d.status === "DELIVERED" && card.deemedAcceptanceAgreed && d.deliveredAt && !d.disputeId && now >= Date.parse(d.deliveredAt) + card.terms.acceptanceWindowHours * 3_600_000) {
        assertDealTransition(d.status, "ACCEPTED"); d.status = "ACCEPTED"; this.event(d, "DEEMED_ACCEPTED", "system"); deemed++;
      }
    }
    return { lots, requirements: reqs, offers, deemedAcceptances: deemed };
  }

  // ---- requirements --------------------------------------------------
  private requirementFromInput(user: User, input: RequirementInput): Omit<BuyRequirement, "requirementId" | "status" | "version" | "fulfilledQuantity" | "recurrenceTemplateId"> {
    this.assertOrgMember(user, input.organizationId);
    const m = MARKETS[input.destinationMarketId];
    if (!m) throw invalid("UNKNOWN_MARKET", "Unknown destination market");
    return { buyerId: user.userId, organizationId: input.organizationId, productId: input.productId, gradeAttributes: input.gradeAttributes ?? {}, gradeGroup: input.gradeGroup, unit: input.unit, targetQuantity: input.targetQuantity, minQuantity: input.minQuantity ?? input.targetQuantity, partialAllowed: input.partialAllowed ?? false, destination: { marketId: m.marketId, lat: m.lat, lon: m.lon }, maxRadiusKm: input.maxRadiusKm, requiredFrom: input.requiredFrom, requiredBy: input.requiredBy, expiresAt: input.expiresAt, maxUnitPricePaise: input.maxUnitPricePaise, requiredClaims: input.requiredClaims ?? [] };
  }
  createRequirement(user: User, input: RequirementInput): BuyRequirement {
    if (!this.isVerifiedParty(user.userId)) throw forbidden("Buyer verification required to publish a requirement");
    const base = this.requirementFromInput(user, input);
    const r: BuyRequirement = { ...base, requirementId: uid("req"), fulfilledQuantity: "0", recurrenceTemplateId: undefined, status: "ACTIVE", version: 1 };
    const issues = validateRequirement(r, this.now());
    if (issues.length) throw invalid("REQUIREMENT_INVALID", issues.join(", "));
    this.requirements.set(r.requirementId, r);
    return r;
  }
  createRecurringRequirement(user: User, input: RequirementInput, cadence: Cadence, occurrences: number) {
    if (!this.isVerifiedParty(user.userId)) throw forbidden("Buyer verification required to publish a requirement");
    if (occurrences < 2 || occurrences > 52) throw invalid("OCCURRENCES_INVALID", "2–52 occurrences");
    const tpl: RecurrenceTemplate = { templateId: uid("tpl"), cadence, occurrences, base: this.requirementFromInput(user, input) };
    const instances = instantiateRecurrence(tpl, () => uid("req"));
    for (const r of instances) {
      const issues = validateRequirement(r, new Date(Date.parse(r.expiresAt) - 1));
      if (issues.length) throw invalid("REQUIREMENT_INVALID", issues.join(", "));
    }
    this.templates.set(tpl.templateId, tpl);
    for (const r of instances) this.requirements.set(r.requirementId, r);
    return { template: tpl, instances };
  }
  /** Editing a template only affects instances generated afterwards. */
  extendRecurrence(user: User, templateId: string, patch: { targetQuantity?: string; minQuantity?: string; maxUnitPricePaise?: number }, moreOccurrences: number) {
    const t = this.templates.get(templateId);
    if (!t || t.base.buyerId !== user.userId) throw notFound("Template");
    const existing = [...this.requirements.values()].filter((r) => r.recurrenceTemplateId === templateId);
    const next: RecurrenceTemplate = { ...t, base: { ...t.base, ...patch }, occurrences: t.occurrences + moreOccurrences };
    this.templates.set(templateId, next);
    const all = instantiateRecurrence(next, () => uid("req"));
    const fresh = all.slice(existing.length);
    for (const r of fresh) this.requirements.set(r.requirementId, { ...r, status: "DRAFT" });
    return fresh;
  }
  closeRequirement(user: User, id: string) {
    const r = this.getReq(id);
    if (r.buyerId !== user.userId) throw notFound("Requirement");
    r.status = "CLOSED"; r.version++;
    return r;
  }

  // ---- matching ------------------------------------------------------
  matchesForRequirement(user: User, requirementId: string, asOperator = false): MatchCandidate[] {
    const r = this.getReq(requirementId);
    if (r.buyerId !== user.userId && !asOperator) throw notFound("Requirement");
    return this.computeMatches(r, asOperator);
  }
  matchesForLot(user: User, lotId: string, asOperator = false): MatchCandidate[] {
    const l = this.ownLot(user, lotId);
    const all = [...this.requirements.values()].map((r) => this.matchPair(l, r));
    return asOperator ? all : rankMatches(all).map(({ incompatibilities: _i, ...c }) => ({ ...c, incompatibilities: [] }));
  }
  private matchPair(l: SellLot, r: BuyRequirement) {
    const prior = this.reputation.some((e) => e.type === "DEAL_COMPLETED" && e.partyId === l.sellerId && this.deals.get(e.dealId)?.buyerId === r.buyerId);
    return matchLotToRequirement(l, r, this.participant(l.sellerId), this.participant(r.buyerId), this.lotLocation(l), this.now(), prior);
  }
  private computeMatches(r: BuyRequirement, includeIneligible: boolean) {
    const all = [...this.lots.values()].map((l) => this.matchPair(l, r));
    return includeIneligible ? all.sort((a, b) => b.score - a.score) : rankMatches(all);
  }
  operatorMatches(op: User, session: Session, requirementId: string) {
    this.require(op, session, "ops.listings");
    return this.computeMatches(this.getReq(requirementId), true);
  }

  // ---- offers --------------------------------------------------------
  createOffer(buyer: User, input: { sellLotId: string; requirementId?: string; terms: OfferTerms; expiresAt: string }): Offer {
    const lot = this.getLot(input.sellLotId);
    if (lot.sellerId === buyer.userId) throw forbidden("Cannot offer on your own lot");
    if (!this.isVerifiedParty(buyer.userId)) throw forbidden("Buyer verification required to make offers");
    if (!["ACTIVE", "RESERVED"].includes(lot.status) || Date.parse(lot.expiresAt) <= this.now().getTime()) throw conflict("LOT_NOT_AVAILABLE", "Lot is not accepting offers");
    if (this.users.get(lot.sellerId)?.blocked.includes(buyer.userId) || buyer.blocked.includes(lot.sellerId)) throw notFound("Sell lot");
    if (input.requirementId) { const r = this.getReq(input.requirementId); if (r.buyerId !== buyer.userId) throw forbidden(); }
    const issues = validateOfferTerms(input.terms, lot, input.expiresAt, this.now());
    if (issues.length) throw invalid("OFFER_INVALID", issues.join(", "));
    const thread: Thread = [...this.threads.values()].find((t) => t.sellLotId === lot.sellLotId && t.buyerId === buyer.userId) ?? { threadId: uid("neg"), sellLotId: lot.sellLotId, sellerId: lot.sellerId, buyerId: buyer.userId, offerIds: [], contactRevealed: false };
    if (thread.offerIds.some((id) => this.offers.get(id)?.status === "ACTIVE")) throw conflict("ACTIVE_OFFER_EXISTS", "There is already an active offer in this negotiation");
    const o: Offer = { offerId: uid("offer"), threadId: thread.threadId, revision: thread.offerIds.length + 1, previousOfferId: thread.offerIds[thread.offerIds.length - 1], sellLotId: lot.sellLotId, requirementId: input.requirementId, createdByPartyId: buyer.userId, sellerId: lot.sellerId, buyerId: buyer.userId, terms: Object.freeze({ ...input.terms }) as OfferTerms, estimatedTotalPaise: totalForTerms(input.terms), expiresAt: input.expiresAt, status: "ACTIVE", version: 1, createdAt: this.iso() };
    thread.offerIds.push(o.offerId);
    this.threads.set(thread.threadId, thread);
    this.offers.set(o.offerId, o);
    this.notify(lot.sellerId, "SMS", "offer.received", { offerId: o.offerId }, `offer:${o.offerId}`);
    return o;
  }
  counterOffer(user: User, offerId: string, terms: OfferTerms, expiresAt: string, expectedVersion?: number): Offer {
    const prev = this.getOffer(offerId);
    this.assertParty(user, prev);
    this.expectVersion(prev.version, expectedVersion);
    assertOfferAcceptable(prev, this.now());
    if (prev.createdByPartyId === user.userId) throw forbidden("Cannot counter your own offer");
    const lot = this.getLot(prev.sellLotId);
    const issues = validateOfferTerms(terms, lot, expiresAt, this.now());
    if (issues.length) throw invalid("OFFER_INVALID", issues.join(", "));
    prev.status = "COUNTERED"; prev.version++;
    const thread = this.threads.get(prev.threadId) as Thread;
    const o: Offer = { ...prev, offerId: uid("offer"), revision: prev.revision + 1, previousOfferId: prev.offerId, createdByPartyId: user.userId, terms: Object.freeze({ ...terms }) as OfferTerms, estimatedTotalPaise: totalForTerms(terms), expiresAt, status: "ACTIVE", version: 1, createdAt: this.iso() };
    thread.offerIds.push(o.offerId);
    this.offers.set(o.offerId, o);
    this.notify(user.userId === prev.sellerId ? prev.buyerId : prev.sellerId, "SMS", "offer.countered", { offerId: o.offerId }, `offer:${o.offerId}`);
    return o;
  }
  private assertParty(user: User, o: { sellerId: string; buyerId: string }) {
    if (user.userId !== o.sellerId && user.userId !== o.buyerId) throw notFound("Offer");
  }
  rejectOffer(user: User, offerId: string) {
    const o = this.getOffer(offerId); this.assertParty(user, o);
    assertOfferAcceptable(o, this.now());
    if (o.createdByPartyId === user.userId) throw forbidden("Use withdraw for your own offer");
    o.status = "REJECTED"; o.version++; return o;
  }
  withdrawOffer(user: User, offerId: string) {
    const o = this.getOffer(offerId); this.assertParty(user, o);
    if (o.createdByPartyId !== user.userId) throw forbidden();
    assertOfferAcceptable(o, this.now());
    o.status = "WITHDRAWN"; o.version++; return o;
  }
  listOffers(user: User) { return [...this.offers.values()].filter((o) => o.sellerId === user.userId || o.buyerId === user.userId); }

  /**
   * Acceptance is a single synchronous unit (no awaits): reload, validate, reserve, create deal.
   * Because of that no concurrent acceptance can interleave; a persistence layer must replace this
   * with a row-locked transaction (see docs/domain/marketplace.md §5).
   */
  acceptOffer(user: User, offerId: string, expectedVersion?: number): Deal {
    const o = this.getOffer(offerId); this.assertParty(user, o);
    this.expectVersion(o.version, expectedVersion);
    if (o.createdByPartyId === user.userId) throw forbidden("Cannot accept your own offer");
    assertOfferAcceptable(o, this.now());
    const lot = this.getLot(o.sellLotId);
    if (!["ACTIVE", "RESERVED"].includes(lot.status)) throw conflict("LOT_NOT_AVAILABLE", "Lot is no longer available");
    if (compareQuantity(o.terms.quantity, availableQuantity(lot)) > 0) throw conflict("INSUFFICIENT_QUANTITY", "Another acceptance has already reserved this quantity");
    if (this.users.get(lot.sellerId)?.suspended) throw conflict("PARTICIPANT_SUSPENDED", "Counterparty unavailable");
    o.status = "ACCEPTED"; o.version++;
    lot.quantityReserved = addQuantity(lot.quantityReserved, o.terms.quantity);
    const remaining = availableQuantity(lot);
    lot.status = "RESERVED"; // partial reservations keep the rest discoverable via the RESERVED+available rule
    if (toMilli(remaining) > 0n && lot.partialFulfilmentAllowed) lot.status = "RESERVED";
    lot.version++;
    for (const other of this.offers.values()) if (other.sellLotId === lot.sellLotId && other.status === "ACTIVE" && other.offerId !== o.offerId && compareQuantity(other.terms.quantity, remaining) > 0) { other.status = "INVALIDATED"; other.version++; }
    if (o.requirementId) { const r = this.requirements.get(o.requirementId); if (r) { r.fulfilledQuantity = addQuantity(r.fulfilledQuantity, o.terms.quantity); if (compareQuantity(r.fulfilledQuantity, r.targetQuantity) >= 0) { r.status = "FILLED"; r.version++; } } }
    const deal: Deal = { dealId: uid("deal"), sellLotId: lot.sellLotId, requirementId: o.requirementId, sellerId: o.sellerId, buyerId: o.buyerId, status: "AGREED", cards: [], events: [], pendingAmendment: undefined, deliveredAt: undefined, disputeId: undefined, version: 1 };
    deal.cards.push(Object.freeze({ revision: 1, terms: o.terms, totalPaise: o.estimatedTotalPaise, offerId: o.offerId, lotSnapshot: Object.freeze({ productId: lot.productId, gradeAttributes: { ...lot.gradeAttributes }, originMarketId: lot.originMarketId }), createdAt: this.iso(), acceptedBy: [o.createdByPartyId, user.userId], deemedAcceptanceAgreed: true }) as Deal["cards"][number]);
    this.event(deal, "DEAL_CREATED", user.userId, { offerId: o.offerId });
    this.deals.set(deal.dealId, deal);
    this.log(user.userId, "OFFER_ACCEPTED", o.offerId, undefined, { dealId: deal.dealId });
    return deal;
  }

  // ---- contact reveal / block / report --------------------------------
  revealContact(user: User, threadId: string, reason = "NEGOTIATION"): { phone: string } {
    const t = this.threads.get(threadId);
    if (!t || (t.sellerId !== user.userId && t.buyerId !== user.userId)) throw notFound("Thread");
    const dayAgo = this.now().getTime() - 86_400_000;
    if (this.reveals.filter((r) => r.by === user.userId && r.at > dayAgo).length >= this.cfg.contactRevealPerDay) throw new DomainError("RATE_LIMITED", 429, "Contact reveal limit reached", "error.rate_limited");
    // Mutual interest gate: the other side must have an offer that is accepted, or have countered.
    const offers = t.offerIds.map((id) => this.offers.get(id) as Offer);
    const mutual = offers.some((o) => o.status === "ACCEPTED") || new Set(offers.map((o) => o.createdByPartyId)).size === 2;
    if (!mutual) throw forbidden("Contact reveal requires mutual interest");
    const otherId = user.userId === t.sellerId ? t.buyerId : t.sellerId;
    const other = this.users.get(otherId) as User;
    if (other.suspended || other.blocked.includes(user.userId) || user.blocked.includes(otherId)) throw forbidden();
    this.reveals.push({ at: this.now().getTime(), by: user.userId, of: otherId, reason });
    t.contactRevealed = true;
    this.log(user.userId, "CONTACT_REVEALED", otherId, reason, { threadId });
    return { phone: other.phone };
  }
  blockUser(user: User, targetId: string) { if (!this.users.has(targetId)) throw notFound("User"); if (!user.blocked.includes(targetId)) user.blocked.push(targetId); }
  reportUser(user: User, subjectUserId: string, reason: string) {
    if (!this.users.has(subjectUserId)) throw notFound("User");
    const r: Report = { reportId: uid("rep"), reporterId: user.userId, subjectUserId, reason, at: this.iso() };
    this.reports.push(r);
    this.enqueue({ queue: "RISK", subject: subjectUserId, summary: "User reported", reasons: [reason], priority: 2, requiredCapability: "ops.listings" });
    return r;
  }
  suspendUser(op: User, session: Session, userId: string, reason: string) {
    this.require(op, session, "ops.listings");
    if (!reason) throw invalid("REASON_REQUIRED", "A reason is required");
    const u = this.users.get(userId) ?? (() => { throw notFound("User"); })();
    u.suspended = true;
    this.revokeAllSessions(userId);
    for (const l of this.lots.values()) if (l.sellerId === userId && ["ACTIVE", "RESERVED"].includes(l.status) && toMilli(l.quantityReserved) === 0n) { l.status = "SUSPENDED"; l.version++; }
    this.log(op.userId, "USER_SUSPENDED", userId, reason);
  }

  // ---- deals ---------------------------------------------------------
  private event(d: Deal, type: DealEventType, actorId: string, data?: Record<string, unknown>) {
    const ev: DealEvent = { seq: d.events.length + 1, type, actorId, at: this.iso(), ...(data ? { data } : {}) };
    d.events.push(Object.freeze(ev) as DealEvent);
    d.version++;
  }
  private dealParty(user: User, id: string) { const d = this.getDeal(id); if (d.sellerId !== user.userId && d.buyerId !== user.userId) throw notFound("Deal"); return d; }
  getDeal2(user: User, id: string, op?: { session: Session }) {
    const d = this.deals.get(id) ?? (() => { throw notFound("Deal"); })();
    if (d.sellerId === user.userId || d.buyerId === user.userId) return d;
    if (op && d.disputeId) { this.require(user, op.session, "ops.disputes"); return d; }
    throw notFound("Deal");
  }
  listDeals(user: User) { return [...this.deals.values()].filter((d) => d.sellerId === user.userId || d.buyerId === user.userId); }

  /** A material amendment requires acceptance by both parties; non-material ones also need the counterparty. */
  proposeAmendment(user: User, dealId: string, terms: OfferTerms) {
    const d = this.dealParty(user, dealId);
    if (["COMPLETED", "CANCELLED", "DISPUTED"].includes(d.status)) throw conflict("DEAL_CLOSED", `Deal is ${d.status}`);
    if (d.pendingAmendment) throw conflict("AMENDMENT_PENDING", "An amendment is already pending");
    const cur = currentCard(d).terms;
    const changed = (Object.keys(terms) as (keyof OfferTerms)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(terms[k]));
    if (!changed.length) throw invalid("NO_CHANGE", "Amendment changes nothing");
    const lot = this.getLot(d.sellLotId);
    if (terms.quantity !== cur.quantity) {
      const room = addQuantity(availableQuantity(lot), cur.quantity);
      if (compareQuantity(terms.quantity, room) > 0) throw conflict("INSUFFICIENT_QUANTITY", "Not enough quantity for amendment");
    }
    d.pendingAmendment = { terms, proposedBy: user.userId };
    this.event(d, "AMENDMENT_PROPOSED", user.userId, { changed, material: changed.some((k) => MATERIAL_TERM_FIELDS.includes(k)) });
    return d;
  }
  respondAmendment(user: User, dealId: string, accept: boolean) {
    const d = this.dealParty(user, dealId);
    const p = d.pendingAmendment;
    if (!p) throw conflict("NO_PENDING_AMENDMENT", "No amendment pending");
    if (p.proposedBy === user.userId) throw forbidden("The proposer cannot accept their own amendment");
    d.pendingAmendment = undefined;
    if (!accept) { this.event(d, "AMENDMENT_REJECTED", user.userId); return d; }
    const prev = currentCard(d);
    const lot = this.getLot(d.sellLotId);
    lot.quantityReserved = addQuantity(subtractQuantity(lot.quantityReserved, prev.terms.quantity), p.terms.quantity);
    d.cards.push(Object.freeze({ ...prev, revision: prev.revision + 1, terms: Object.freeze({ ...p.terms }) as OfferTerms, totalPaise: totalForTerms(p.terms), createdAt: this.iso(), acceptedBy: [p.proposedBy, user.userId] }) as Deal["cards"][number]);
    this.event(d, "AMENDMENT_ACCEPTED", user.userId, { revision: prev.revision + 1 });
    return d;
  }
  private moveDeal(d: Deal, to: Deal["status"], type: DealEventType, actor: string, data?: Record<string, unknown>) {
    assertDealTransition(d.status, to);
    d.status = to;
    this.event(d, type, actor, data);
  }
  confirmPickup(user: User, dealId: string) {
    const d = this.dealParty(user, dealId);
    if (d.pendingAmendment) throw conflict("AMENDMENT_PENDING", "Resolve the pending amendment first");
    this.moveDeal(d, "PICKUP_CONFIRMED", "PICKUP_CONFIRMED", user.userId); return d;
  }
  confirmDelivery(user: User, dealId: string, actualQuantity?: string) {
    const d = this.dealParty(user, dealId);
    if (user.userId !== d.sellerId && currentCard(d).terms.fulfilmentMode === "DELIVERY") throw forbidden("Delivery is confirmed by the seller");
    this.moveDeal(d, "DELIVERED", "DELIVERED", user.userId, { actualQuantity: actualQuantity ?? currentCard(d).terms.quantity });
    d.deliveredAt = this.iso();
    this.reputation.push({ partyId: d.sellerId, type: Date.parse(this.iso()) <= Date.parse(currentCard(d).terms.fulfilmentBy) ? "ON_TIME" : "LATE", dealId, at: this.iso() });
    return d;
  }
  acceptDelivery(user: User, dealId: string) {
    const d = this.dealParty(user, dealId);
    if (user.userId !== d.buyerId) throw forbidden("Only the buyer accepts delivery");
    this.moveDeal(d, "ACCEPTED", "BUYER_ACCEPTED", user.userId);
    this.reputation.push({ partyId: d.sellerId, type: "QUANTITY_ACCEPTED_FULL", dealId, at: this.iso() });
    return d;
  }
  confirmPayment(user: User, dealId: string, method: string) {
    const d = this.dealParty(user, dealId);
    if (user.userId !== d.sellerId) throw forbidden("Payment is confirmed by the receiving seller");
    this.moveDeal(d, "PAYMENT_CONFIRMED", "PAYMENT_CONFIRMED", user.userId, { method, guarantee: false }); // confirmation only; no payment guarantee
    this.reputation.push({ partyId: d.buyerId, type: "PAYMENT_ON_TIME", dealId, at: this.iso() });
    return d;
  }
  completeDeal(user: User, dealId: string) {
    const d = this.dealParty(user, dealId);
    if (d.disputeId && this.disputes.get(d.disputeId)?.status !== "RESOLVED") throw conflict("DISPUTE_OPEN", "Resolve the dispute first");
    this.moveDeal(d, "COMPLETED", "COMPLETED", user.userId);
    const lot = this.getLot(d.sellLotId);
    if (compareQuantity(lot.quantityReserved, lot.quantityTotal) >= 0) { lot.status = "SOLD"; lot.version++; }
    for (const p of [d.sellerId, d.buyerId]) this.reputation.push({ partyId: p, type: "DEAL_COMPLETED", dealId, at: this.iso() });
    return d;
  }
  cancelDeal(user: User, dealId: string, reason: string) {
    const d = this.dealParty(user, dealId);
    if (!reason) throw invalid("REASON_REQUIRED", "A cancellation reason is required");
    this.moveDeal(d, "CANCELLED", "CANCELLED", user.userId, { reason });
    const lot = this.getLot(d.sellLotId);
    lot.quantityReserved = subtractQuantity(lot.quantityReserved, currentCard(d).terms.quantity);
    lot.status = lot.status === "SOLD" ? lot.status : toMilli(lot.quantityReserved) === 0n ? "ACTIVE" : "RESERVED";
    lot.version++;
    this.reputation.push({ partyId: user.userId, type: "CANCELLED_BY_PARTY", dealId, at: this.iso() });
    return d;
  }
  addDealEvidence(user: User, dealId: string, kind: string, note: string): Evidence {
    const d = this.dealParty(user, dealId);
    const e: Evidence = { evidenceId: uid("ev"), ownerId: user.userId, dealId, kind, visibleTo: [d.sellerId, d.buyerId], note, at: this.iso(), sensitive: false };
    this.evidence.set(e.evidenceId, e);
    this.event(d, "EVIDENCE_ADDED", user.userId, { evidenceId: e.evidenceId, kind });
    return e;
  }
  dealEvidence(user: User, session: Session | undefined, dealId: string): Evidence[] {
    const d = this.deals.get(dealId) ?? (() => { throw notFound("Deal"); })();
    const party = d.sellerId === user.userId || d.buyerId === user.userId;
    if (!party) { if (!d.disputeId) throw notFound("Deal"); this.require(user, session, "ops.disputes"); this.log(user.userId, "DEAL_EVIDENCE_VIEWED", dealId); }
    return [...this.evidence.values()].filter((e) => e.dealId === dealId);
  }

  // ---- disputes ------------------------------------------------------
  openDispute(user: User, dealId: string, input: { reason: DisputeReason; claimedQuantity?: string; claimedAmountPaise?: number; evidenceIds?: string[] }): Dispute {
    const d = this.dealParty(user, dealId);
    if (d.disputeId) throw conflict("DISPUTE_EXISTS", "A dispute already exists for this deal");
    const card = currentCard(d);
    const windowEnds = d.deliveredAt ? Date.parse(d.deliveredAt) + card.terms.acceptanceWindowHours * 3_600_000 : Infinity;
    const anytime: DisputeReason[] = ["NON_PAYMENT", "NO_SHOW", "DELIVERY_FAILURE"];
    if (!anytime.includes(input.reason) && this.now().getTime() > windowEnds) throw conflict("DISPUTE_WINDOW_CLOSED", "The acceptance window has closed");
    if (["COMPLETED", "CANCELLED"].includes(d.status)) throw conflict("DEAL_CLOSED", `Deal is ${d.status}`);
    for (const id of input.evidenceIds ?? []) if (!this.evidence.get(id)?.visibleTo.includes(user.userId)) throw invalid("EVIDENCE_NOT_FOUND", "Unknown evidence");
    const respondent = user.userId === d.sellerId ? d.buyerId : d.sellerId;
    const dis: Dispute = { disputeId: uid("dis"), dealId, openedBy: user.userId, respondent, reason: input.reason, claimedQuantity: input.claimedQuantity, claimedAmountPaise: input.claimedAmountPaise, evidenceIds: input.evidenceIds ?? [], status: "AWAITING_RESPONSE", responseDueAt: new Date(this.now().getTime() + DISPUTE_RESPONSE_HOURS * 3_600_000).toISOString(), response: undefined, resolution: undefined, openedAt: this.iso() };
    this.disputes.set(dis.disputeId, dis);
    this.disputeBefore.set(dis.disputeId, d.status);
    this.moveDeal(d, "DISPUTED", "DISPUTE_OPENED", user.userId, { disputeId: dis.disputeId, reason: input.reason });
    d.disputeId = dis.disputeId;
    this.reputation.push({ partyId: user.userId, type: "DISPUTE_OPENED", dealId, at: this.iso() });
    this.enqueue({ queue: "DISPUTE", subject: dis.disputeId, summary: `Dispute: ${input.reason}`, reasons: [input.reason], priority: 1, requiredCapability: "ops.disputes" });
    this.notify(respondent, "SMS", "dispute.opened", { disputeId: dis.disputeId, dueAt: dis.responseDueAt }, `dispute:${dis.disputeId}`);
    return dis;
  }
  disputeBefore = new Map<string, Deal["status"]>();
  respondDispute(user: User, disputeId: string, text: string, evidenceIds: string[] = []) {
    const dis = this.disputes.get(disputeId) ?? (() => { throw notFound("Dispute"); })();
    if (dis.respondent !== user.userId) throw notFound("Dispute");
    if (dis.response) throw conflict("ALREADY_RESPONDED", "Response already recorded");
    if (this.now().getTime() > Date.parse(dis.responseDueAt)) throw conflict("RESPONSE_WINDOW_CLOSED", "Response window closed");
    dis.response = { text, at: this.iso(), evidenceIds };
    dis.status = "UNDER_REVIEW";
    return dis;
  }
  /** Operators see the Deal Card and events but cannot change them: resolution is a separate, audited record. */
  resolveDispute(op: User, session: Session, disputeId: string, outcome: DisputeOutcome, reason: string) {
    this.require(op, session, "ops.disputes");
    if (!reason) throw invalid("REASON_REQUIRED", "A resolution reason is required");
    const dis = this.disputes.get(disputeId) ?? (() => { throw notFound("Dispute"); })();
    if (dis.status === "RESOLVED") throw conflict("ALREADY_RESOLVED", "Dispute already resolved");
    if (dis.status === "AWAITING_RESPONSE" && this.now().getTime() <= Date.parse(dis.responseDueAt)) throw conflict("RESPONSE_WINDOW_OPEN", "Counterparty response window is still open");
    dis.resolution = { outcome, reason, operatorId: op.userId, at: this.iso() };
    dis.status = "RESOLVED";
    const d = this.getDeal(dis.dealId);
    const before = this.disputeBefore.get(disputeId) ?? "DELIVERED";
    const back = before === "PAYMENT_CONFIRMED" ? "PAYMENT_CONFIRMED" : ["AGREED", "PICKUP_CONFIRMED"].includes(before) ? "CANCELLED" : "ACCEPTED";
    this.moveDeal(d, back as Deal["status"], "DISPUTE_RESOLVED", op.userId, { outcome });
    if (outcome === "UPHELD" || outcome === "PARTIALLY_UPHELD") this.reputation.push({ partyId: dis.respondent, type: "DISPUTE_UPHELD_AGAINST", dealId: d.dealId, at: this.iso() });
    for (const q of this.queue.values()) if (q.subject === disputeId) q.status = "DONE";
    this.log(op.userId, "DISPUTE_RESOLVED", disputeId, reason, { outcome });
    return dis;
  }
  getDispute(user: User, id: string) { const dis = this.disputes.get(id); if (!dis || (dis.openedBy !== user.userId && dis.respondent !== user.userId)) throw notFound("Dispute"); return dis; }

  // ---- reputation & ops ----------------------------------------------
  publicReputation(partyId: string) { return reputationSummary(this.reputation, partyId); }

  listQueue(op: User, session: Session, queue?: QueueItem["queue"]) {
    const items = [...this.queue.values()].filter((q) => q.status === "OPEN" && (!queue || q.queue === queue) && op.capabilities.includes(q.requiredCapability));
    if (!op.capabilities.some((c) => c.startsWith("ops."))) throw forbidden();
    if (!session || session.stepUpUntil < this.now().getTime()) throw new DomainError("STEP_UP_REQUIRED", 403, "Step-up authentication required");
    return items.sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.queueItemId.localeCompare(b.queueItemId)).map((q) => ({ ...q, ageMinutes: Math.floor((this.now().getTime() - Date.parse(q.createdAt)) / 60_000) }));
  }
  readAudit(op: User, session: Session) { this.require(op, session, "ops.audit"); return [...this.audit]; }
}

export interface RequirementInput {
  organizationId?: string; productId: ProductId; gradeAttributes?: Record<string, string>; gradeGroup: string; unit: Unit;
  targetQuantity: string; minQuantity?: string; partialAllowed?: boolean; destinationMarketId: string; maxRadiusKm: number;
  requiredFrom: string; requiredBy: string; expiresAt: string; maxUnitPricePaise?: number; requiredClaims?: string[];
}
export { haversineKm };
export type { ObservationState, SourceClass };
