import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError, conflict, forbidden, invalid, notFound } from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { AuditLog, WorkQueue } from "../../core/audit.ts";
import type { Notifier } from "../../core/notifier.ts";
import type { Capability, ClaimType, Evidence, IdentityConfig, OrgKind, OrgRole, Organization, OtpRecord, Session, User, VerificationClaim } from "./identity.types.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const HOUR = 3_600_000;

export function normalizePhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (/^91\d{10}$/.test(d)) return `+${d}`;
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  throw invalid("INVALID_PHONE", "Phone number must be a valid Indian mobile number");
}

const unauthenticated = () => new DomainError("UNAUTHENTICATED", 401, "Authentication required", "error.unauthenticated");
const stepUpRequired = (msg = "Step-up authentication required") => new DomainError("STEP_UP_REQUIRED", 403, msg);

/** Phone OTP sign-in, sessions and step-up, capabilities, organisations, verification claims and evidence access. */
export class IdentityService {
  private readonly cfg: IdentityConfig;
  private readonly audit: AuditLog;
  private readonly queue: WorkQueue;
  private readonly notifier: Notifier;

  constructor(cfg: IdentityConfig, audit: AuditLog, queue: WorkQueue, notifier: Notifier) {
    this.cfg = cfg;
    this.audit = audit;
    this.queue = queue;
    this.notifier = notifier;
  }

  // ---- users ---------------------------------------------------------------------------------
  user(s: Scope, userId: string) { return s.tx.get<User>(C.users, userId); }
  async requireUser(s: Scope, userId: string) { return orNotFound(await this.user(s, userId), "User"); }
  saveUser(s: Scope, u: User) { return s.tx.put(C.users, u.userId, u); }

  // ---- OTP sign-in ---------------------------------------------------------------------------
  /** Always answers identically so callers cannot enumerate registered numbers. */
  async requestOtp(s: Scope, rawPhone: string, device = "unknown"): Promise<{ sent: true }> {
    const phone = normalizePhone(rawPhone);
    const now = s.ms();
    for (const [key, max] of [[`p:${phone}`, this.cfg.otpMaxPerHour], [`d:${device}`, this.cfg.otpMaxPerHourPerDevice]] as const) {
      const rec = await s.tx.get<{ key: string; times: number[] }>(C.otpRequests, key);
      const recent = (rec?.times ?? []).filter((t) => now - t < HOUR);
      if (recent.length >= max) throw new DomainError("RATE_LIMITED", 429, "Too many requests", "error.rate_limited");
      s.tx.put(C.otpRequests, key, { key, times: [...recent, now] });
    }
    const code = String(100000 + (randomBytes(4).readUInt32BE() % 900000));
    s.tx.put(C.otps, phone, { phone, hash: sha(`${phone}:${code}`), expires: now + this.cfg.otpTtlMs, attempts: 0, used: false });
    this.cfg.deliverOtp(phone, code);
    return { sent: true };
  }

  async verifyOtp(s: Scope, rawPhone: string, code: string, device = "unknown"): Promise<{ token: string; user: User }> {
    const phone = normalizePhone(rawPhone);
    const rec = await s.tx.get<OtpRecord>(C.otps, phone);
    // The attempt counter must survive the failure, so the error asks for the unit of work to be committed.
    const bad = () => Object.assign(new DomainError("OTP_INVALID", 401, "The code is invalid or expired", "error.otp_invalid"), { persistState: true });
    if (!rec || rec.used || rec.expires < s.ms() || rec.attempts >= 5) throw bad();
    rec.attempts++;
    s.tx.put(C.otps, phone, rec);
    if (!eq(rec.hash, sha(`${phone}:${code}`))) throw bad();
    rec.used = true;
    let user = (await s.tx.find<User>(C.users, { phone }))[0];
    if (!user) {
      user = { userId: uid("user"), phone, displayName: "", actingAs: "INDEPENDENT", organizationIds: [], capabilities: this.cfg.operators[phone] ?? [], suspended: false, blocked: [], locale: "ta", createdAt: s.iso() };
      this.saveUser(s, user);
      this.grantClaim(s, user.userId, "MOBILE_CONTROL", {});
    }
    if (user.suspended) throw forbidden("Account suspended");
    // rotate: a new sign-in on a device revokes that device's older sessions
    for (const old of await s.tx.find<Session>(C.sessions, { userId: user.userId, device, revoked: false })) s.tx.put(C.sessions, old.token, { ...old, revoked: true });
    const token = randomBytes(32).toString("base64url");
    s.tx.put(C.sessions, sha(token), { token: sha(token), userId: user.userId, createdAt: s.iso(), stepUpUntil: 0, revoked: false, device } satisfies Session);
    return { token, user };
  }

  async authenticate(s: Scope, token: string | undefined): Promise<{ user: User; session: Session }> {
    if (!token) throw unauthenticated();
    const session = await s.tx.get<Session>(C.sessions, sha(token));
    const user = session && !session.revoked ? await this.user(s, session.userId) : undefined;
    if (!session || !user) throw unauthenticated();
    if (user.suspended) throw forbidden("Account suspended");
    return { user, session };
  }

  /** Step-up re-uses an OTP sent to the actor's own phone. */
  async stepUp(s: Scope, code: string) {
    const { user, session } = s;
    const rec = await s.tx.get<OtpRecord>(C.otps, user.phone);
    if (!rec || rec.used || rec.expires < s.ms() || !eq(rec.hash, sha(`${user.phone}:${code}`))) throw new DomainError("OTP_INVALID", 401, "Invalid code", "error.otp_invalid");
    s.tx.put(C.otps, user.phone, { ...rec, used: true });
    session.stepUpUntil = s.ms() + this.cfg.stepUpMs;
    s.tx.put(C.sessions, session.token, session);
    this.audit.record(s, user.userId, "AUTH_STEP_UP", user.userId);
  }

  async listSessions(s: Scope) {
    return (await s.tx.find<Session>(C.sessions, { userId: s.user.userId, revoked: false })).map((x) => ({ device: x.device, createdAt: x.createdAt }));
  }
  async revokeAllSessions(s: Scope, userId = s.user.userId) {
    for (const x of await s.tx.find<Session>(C.sessions, { userId, revoked: false })) s.tx.put(C.sessions, x.token, { ...x, revoked: true });
  }

  /** Retention: expired OTPs, stale rate-limit windows and long-revoked sessions. */
  async purgeStaleSecurityState(s: Scope) {
    const now = s.ms();
    let otps = 0, windows = 0, sessions = 0;
    for (const o of await s.tx.find<OtpRecord & { phone: string }>(C.otps)) if (o.used || o.expires + HOUR < now) { s.tx.delete(C.otps, o.phone); otps++; }
    for (const w of await s.tx.find<{ key: string; times: number[] }>(C.otpRequests)) if (w.times.every((t) => now - t > HOUR)) { s.tx.delete(C.otpRequests, w.key); windows++; }
    for (const x of await s.tx.find<Session>(C.sessions, { revoked: true })) if (now - Date.parse(x.createdAt) > 30 * 86_400_000) { s.tx.delete(C.sessions, x.token); sessions++; }
    return { otpsPurged: otps, rateWindowsPurged: windows, sessionsPurged: sessions };
  }

  // ---- authorisation -------------------------------------------------------------------------
  hasStepUp(s: Scope) { return !!s.actor && s.actor.session.stepUpUntil >= s.ms(); }

  /** Server-side capability check. Operator capabilities additionally require a recent step-up. */
  require(s: Scope, cap: Capability) {
    if (!s.user.capabilities.includes(cap)) throw forbidden();
    if (cap !== "price.contribute" && !this.hasStepUp(s)) throw stepUpRequired();
  }

  // ---- profile -------------------------------------------------------------------------------
  async me(s: Scope) {
    const u = s.user;
    return { userId: u.userId, displayName: u.displayName, actingAs: u.actingAs, organizationIds: u.organizationIds, capabilities: u.capabilities, locale: u.locale, claims: await this.claimSummaries(s, u.userId) };
  }
  updateProfile(s: Scope, patch: { displayName?: string; actingAs?: "INDEPENDENT" | "ORGANIZATION"; locale?: "en" | "ta" }) {
    return this.saveUser(s, Object.assign(s.user, patch));
  }

  // ---- organisations -------------------------------------------------------------------------
  org(s: Scope, id: string) { return s.tx.get<Organization>(C.orgs, id); }
  async requireOrg(s: Scope, id: string) { return orNotFound(await this.org(s, id), "Organization"); }
  async isMember(s: Scope, organizationId: string, userId: string) { return !!(await this.org(s, organizationId))?.members.some((m) => m.userId === userId); }

  async createOrganization(s: Scope, name: string, kind: OrgKind): Promise<Organization> {
    const user = s.user;
    const org: Organization = { organizationId: uid("org"), name, kind, members: [{ userId: user.userId, role: "OWNER" }] };
    s.tx.put(C.orgs, org.organizationId, org);
    user.organizationIds.push(org.organizationId);
    this.saveUser(s, user);
    this.audit.record(s, user.userId, "ORG_CREATED", org.organizationId);
    return org;
  }

  async addMember(s: Scope, organizationId: string, userId: string, role: OrgRole) {
    const actor = s.user;
    const org = await this.requireOrg(s, organizationId);
    if (!org.members.some((m) => m.userId === actor.userId && m.role === "OWNER")) throw forbidden();
    if (role !== "MEMBER" && !this.hasStepUp(s)) throw stepUpRequired("Re-authentication required for high-risk membership change");
    const target = await this.requireUser(s, userId);
    org.members = org.members.filter((m) => m.userId !== userId).concat({ userId, role });
    s.tx.put(C.orgs, org.organizationId, org);
    if (!target.organizationIds.includes(organizationId)) { target.organizationIds.push(organizationId); this.saveUser(s, target); }
    this.audit.record(s, actor.userId, "ORG_MEMBER_CHANGED", organizationId, undefined, { userId, role });
    for (const m of org.members.filter((m) => m.role === "OWNER" && m.userId !== actor.userId)) await this.notifier.notify(s, m.userId, "SMS", "org.member_changed", { organizationId, userId, role }, `member:${organizationId}:${userId}:${role}`);
    return org;
  }

  async assertOrgMember(s: Scope, organizationId: string | undefined) {
    if (organizationId && !(await this.isMember(s, organizationId, s.user.userId))) throw forbidden("Not a member of that organization");
  }

  async myOrganizations(s: Scope) {
    const out = [];
    for (const id of s.user.organizationIds) {
      const o = await this.org(s, id);
      if (o) out.push({ organizationId: o.organizationId, name: o.name, kind: o.kind, role: o.members.find((m) => m.userId === s.user.userId)?.role });
    }
    return out;
  }

  // ---- verification claims -------------------------------------------------------------------
  private grantClaim(s: Scope, userId: string, type: ClaimType, scope: Record<string, string>, by = "system") {
    const c: VerificationClaim = { claimId: uid("claim"), userId, type, scope, status: "APPROVED", evidenceIds: [], verifiedAt: s.iso(), expiresAt: undefined, decidedBy: by, reasonCode: "AUTO" };
    return s.tx.put(C.claims, c.claimId, c);
  }

  /** Approved, unexpired claims of a user (optionally of one type). */
  async approvedClaims(s: Scope, userId: string, type?: ClaimType) {
    const rows = await s.tx.find<VerificationClaim>(C.claims, { userId, status: "APPROVED", ...(type ? { type } : {}) });
    return rows.filter((c) => !c.expiresAt || Date.parse(c.expiresAt) > s.ms());
  }
  async hasClaim(s: Scope, userId: string, type: ClaimType, scope?: Record<string, string>) {
    return (await this.approvedClaims(s, userId, type)).some((c) => !scope || Object.entries(scope).every(([k, v]) => c.scope[k] === v));
  }
  async approvedClaimTypes(s: Scope, userId: string) { return [...new Set((await this.approvedClaims(s, userId)).map((c) => c.type))]; }
  async isVerifiedParty(s: Scope, userId: string) { return (await this.hasClaim(s, userId, "PERSON_IDENTITY")) || (await this.hasClaim(s, userId, "ORGANIZATION_EXISTENCE")); }

  async submitClaim(s: Scope, type: ClaimType, scope: Record<string, string>, evidenceNotes: string[]): Promise<VerificationClaim> {
    if (type === "MOBILE_CONTROL") throw invalid("CLAIM_AUTOMATIC", "Mobile claim is granted at login");
    const user = s.user;
    const ids = evidenceNotes.map((note) => {
      const e: Evidence = { evidenceId: uid("ev"), ownerId: user.userId, dealId: undefined, kind: "VERIFICATION_DOCUMENT", visibleTo: [user.userId], note, at: s.iso(), sensitive: true };
      s.tx.put(C.evidence, e.evidenceId, e);
      return e.evidenceId;
    });
    const c: VerificationClaim = { claimId: uid("claim"), userId: user.userId, type, scope, status: "SUBMITTED", evidenceIds: ids, verifiedAt: undefined, expiresAt: undefined, decidedBy: undefined, reasonCode: undefined };
    s.tx.put(C.claims, c.claimId, c);
    this.queue.enqueue(s, { queue: "VERIFICATION", subject: c.claimId, summary: `${type} claim submitted`, reasons: [type], priority: 2, requiredCapability: "ops.verification" });
    return c;
  }

  async decideClaim(s: Scope, claimId: string, decision: "APPROVED" | "REJECTED" | "NEEDS_MORE_INFORMATION" | "REVOKED", reasonCode: string, expiresAt?: string) {
    this.require(s, "ops.verification");
    const op = s.user;
    if (!reasonCode) throw invalid("REASON_REQUIRED", "A reason code is required");
    const c = orNotFound(await s.tx.get<VerificationClaim>(C.claims, claimId), "Claim");
    if (c.userId === op.userId) throw forbidden("Conflict of interest: cannot decide own claim");
    if (decision === "REVOKED" ? c.status !== "APPROVED" : !["SUBMITTED", "IN_REVIEW", "NEEDS_MORE_INFORMATION"].includes(c.status)) throw conflict("INVALID_CLAIM_TRANSITION", `Claim is ${c.status}`);
    c.status = decision;
    c.decidedBy = op.userId;
    c.reasonCode = reasonCode;
    if (decision === "APPROVED") { c.verifiedAt = s.iso(); c.expiresAt = expiresAt; }
    s.tx.put(C.claims, claimId, c);
    await this.queue.close(s, claimId);
    // The contributor capability follows the contributor-scope claim.
    if (c.type === "PRICE_CONTRIBUTOR_SCOPE") {
      const u = await this.user(s, c.userId);
      if (u && decision === "APPROVED" && !u.capabilities.includes("price.contribute")) { u.capabilities.push("price.contribute"); this.saveUser(s, u); }
      if (u && decision === "REVOKED" && !(await this.hasClaim(s, u.userId, "PRICE_CONTRIBUTOR_SCOPE"))) { u.capabilities = u.capabilities.filter((x) => x !== "price.contribute"); this.saveUser(s, u); }
    }
    await this.notifier.notify(s, c.userId, "SMS", `claim.${decision.toLowerCase()}`, { type: c.type }, `claim:${claimId}:${decision}`);
    this.audit.record(s, op.userId, "CLAIM_DECIDED", claimId, reasonCode, { decision });
    return c;
  }

  /** Public summary: never includes evidence documents. */
  async claimSummaries(s: Scope, userId: string, locale: "en" | "ta" = "en") {
    return (await s.tx.find<VerificationClaim>(C.claims, { userId, status: "APPROVED" })).map((c) => ({ type: c.type, status: c.status, verifiedAt: c.verifiedAt, expiresAt: c.expiresAt ?? null, scope: c.scope, displayLabelKey: `claim.${c.type}`, locale }));
  }

  // ---- evidence ------------------------------------------------------------------------------
  evidence(s: Scope, id: string) { return s.tx.get<Evidence>(C.evidence, id); }
  addEvidence(s: Scope, e: Omit<Evidence, "evidenceId" | "at">): Evidence {
    const ev: Evidence = { ...e, evidenceId: uid("ev"), at: s.iso() };
    return s.tx.put(C.evidence, ev.evidenceId, ev);
  }
  evidenceForDeal(s: Scope, dealId: string) { return s.tx.find<Evidence>(C.evidence, { dealId }); }

  async accessEvidence(s: Scope, evidenceId: string): Promise<Evidence> {
    const user = s.user;
    const e = orNotFound(await this.evidence(s, evidenceId), "Evidence");
    if (e.visibleTo.includes(user.userId)) return e;
    if (!e.sensitive || !user.capabilities.includes("ops.sensitive_documents")) throw notFound("Evidence");
    this.require(s, "ops.sensitive_documents");
    this.audit.record(s, user.userId, "SENSITIVE_EVIDENCE_ACCESSED", evidenceId);
    return e;
  }
}
