import { Controller, Get, Inject, Patch, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Public, Shape, created, items, ok, type Ctx } from "../../http/route-kit.ts";
import { IdentityService } from "./identity.service.ts";

/** Phone OTP sign-in, sessions, step-up, profile, organisations and verification claims. */
@Controller("v1")
export class IdentityController {
  private readonly identity: IdentityService;
  constructor(@Inject(IdentityService) identity: IdentityService) { this.identity = identity; }

  @Post("auth/otp/request")
  @Public()
  @Shape({ phone: is.string })
  requestOtp(@C() { s, body, ip }: Ctx) {
    return this.identity.requestOtp(s, body.phone, ip);
  }

  @Post("auth/otp/verify")
  @Public()
  @Shape({ phone: is.string, code: is.string })
  async verifyOtp(@C() { s, body, ip }: Ctx) {
    const { token, user } = await this.identity.verifyOtp(s, body.phone, body.code, ip);
    return { token, user: { userId: user.userId, capabilities: user.capabilities, locale: user.locale } };
  }

  @Post("auth/step-up/request")
  requestStepUp(@C() { s, ip }: Ctx) {
    return this.identity.requestOtp(s, s.user.phone, ip);
  }

  @Post("auth/step-up")
  @Shape({ code: is.string })
  stepUp(@C() { s, body }: Ctx) {
    return ok(this.identity.stepUp(s, body.code));
  }

  @Get("me")
  me(@C() { s }: Ctx) {
    return this.identity.me(s);
  }

  @Patch("me")
  updateMe(@C() { s, body }: Ctx) {
    return ok(this.identity.updateProfile(s, { ...(body.displayName ? { displayName: String(body.displayName) } : {}), ...(body.actingAs ? { actingAs: body.actingAs } : {}), ...(body.locale ? { locale: body.locale } : {}) }));
  }

  @Get("me/organizations")
  myOrganizations(@C() { s }: Ctx) {
    return items(this.identity.myOrganizations(s));
  }

  @Get("me/sessions")
  mySessions(@C() { s }: Ctx) {
    return items(this.identity.listSessions(s));
  }

  @Post("me/sessions/revoke-all")
  revokeAll(@C() { s }: Ctx) {
    return ok(this.identity.revokeAllSessions(s));
  }

  @Post("organizations")
  @Shape({ name: is.string, kind: is.oneOf("FARMER_GROUP", "FPO", "TRADER", "PROCESSOR", "BUYER", "INSPECTION_PARTNER", "LOGISTICS_PARTNER") })
  @Idempotent()
  async createOrganization(@C() { s, body }: Ctx) {
    return created(await this.identity.createOrganization(s, body.name, body.kind));
  }

  @Post("organizations/:id/members")
  @Shape({ userId: is.string, role: is.oneOf("OWNER", "MEMBER", "FINANCE", "VERIFIER") })
  addMember(@C() { s, params, body }: Ctx) {
    return this.identity.addMember(s, params.id as string, body.userId, body.role);
  }

  @Post("claims")
  @Shape({ type: is.string, scope: is.object, evidence: is.stringArray })
  @Idempotent()
  async submitClaim(@C() { s, body }: Ctx) {
    return created(await this.identity.submitClaim(s, body.type, body.scope, body.evidence));
  }

  @Get("me/claims")
  myClaims(@C() { s }: Ctx) {
    return items(this.identity.claimSummaries(s, s.user.userId));
  }
}
