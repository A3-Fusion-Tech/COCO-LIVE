import { Controller, Get, Patch, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Public, Shape, created, type Ctx } from "../route-kit.ts";

/** Phone OTP sign-in, sessions, step-up, profile, organisations and verification claims. */
@Controller("v1")
export class IdentityController {
  @Post("auth/otp/request")
  @Public()
  @Shape({ phone: is.string })
  postAuthOtpRequest(@C() { p, body, ip }: Ctx) {
    return p.requestOtp(body.phone, ip);
  }

  @Post("auth/otp/verify")
  @Public()
  @Shape({ phone: is.string, code: is.string })
  postAuthOtpVerify(@C() { p, body, ip }: Ctx) {
    const { token, user } = p.verifyOtp(body.phone, body.code, ip);
    return { token, user: { userId: user.userId, capabilities: user.capabilities, locale: user.locale } };
  }

  @Post("auth/step-up/request")
  postAuthStepUpRequest(@C() { p, user, ip }: Ctx) {
    return p.requestOtp(user.phone, ip);
  }

  @Post("auth/step-up")
  @Shape({ code: is.string })
  postAuthStepUp(@C() { p, user, session, body }: Ctx) {
    return (p.stepUp(session, user, body.code), { ok: true });
  }

  @Get("me")
  getMe(@C() { user, p }: Ctx) {
    return ({ userId: user.userId, displayName: user.displayName, actingAs: user.actingAs, organizationIds: user.organizationIds, capabilities: user.capabilities, locale: user.locale, claims: p.claimSummaries(user.userId) });
  }

  @Patch("me")
  patchMe(@C() { p, user, body }: Ctx) {
    return p.updateProfile(user, { ...(body.displayName ? { displayName: String(body.displayName) } : {}), ...(body.actingAs ? { actingAs: body.actingAs } : {}), ...(body.locale ? { locale: body.locale } : {}) }) && { ok: true };
  }

  @Get("me/organizations")
  getMeOrganizations(@C() { p, user }: Ctx) {
    return ({ items: user.organizationIds.map((id) => p.orgs.get(id)).filter(Boolean).map((o) => ({ organizationId: o!.organizationId, name: o!.name, kind: o!.kind, role: o!.members.find((m) => m.userId === user.userId)?.role })) });
  }

  @Get("me/sessions")
  getMeSessions(@C() { p, user }: Ctx) {
    return ({ items: p.listSessions(user.userId) });
  }

  @Post("me/sessions/revoke-all")
  postMeSessionsRevokeAll(@C() { p, user }: Ctx) {
    return (p.revokeAllSessions(user.userId), { ok: true });
  }

  @Post("organizations")
  @Shape({ name: is.string, kind: is.oneOf("FARMER_GROUP", "FPO", "TRADER", "PROCESSOR", "BUYER", "INSPECTION_PARTNER", "LOGISTICS_PARTNER") })
  @Idempotent()
  postOrganizations(@C() { p, user, body }: Ctx) {
    return created(p.createOrganization(user, body.name, body.kind));
  }

  @Post("organizations/:id/members")
  @Shape({ userId: is.string, role: is.oneOf("OWNER", "MEMBER", "FINANCE", "VERIFIER") })
  postOrganizationsMembers(@C() { p, user, session, params, body }: Ctx) {
    return p.addMember(user, params.id as string, body.userId, body.role, session);
  }

  @Post("claims")
  @Shape({ type: is.string, scope: is.object, evidence: is.stringArray })
  @Idempotent()
  postClaims(@C() { p, user, body }: Ctx) {
    return created(p.submitClaim(user, body.type, body.scope, body.evidence));
  }

  @Get("me/claims")
  getMeClaims(@C() { p, user }: Ctx) {
    return ({ items: p.claimSummaries(user.userId) });
  }
}
