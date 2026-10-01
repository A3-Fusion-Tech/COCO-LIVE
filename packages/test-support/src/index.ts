import { Platform, type Config, type Session, type User } from "../../../apps/api/src/platform.ts";
import type { OfferTerms } from "../../../packages/domain/src/index.ts";

export class FakeClock {
  private t = Date.parse("2026-10-01T06:00:00Z");
  now = () => new Date(this.t);
  advanceHours(h: number) { this.t += h * 3_600_000; }
  advanceMinutes(m: number) { this.t += m * 60_000; }
}

export const OPS_CAPS = ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit", "ops.sensitive_documents"] as const;

export function makeWorld(extra: Partial<Config> = {}) {
  const clock = new FakeClock();
  const otps = new Map<string, string>();
  const p = new Platform({ clock: clock.now, deliverOtp: (ph, c) => otps.set(ph, c), operators: { "+919000000001": [...OPS_CAPS], "+919000000002": [...OPS_CAPS] }, ...extra });
  let n = 0;
  const login = (phone: string, device = `dev${++n}`): { user: User; token: string; session: Session } => {
    p.requestOtp(phone, device);
    const { token, user } = p.verifyOtp(phone, otps.get(phone.startsWith("+") ? phone : `+91${phone}`) as string, device);
    return { user, token, session: p.authenticate(token).session };
  };
  const ops = new Map<string, { user: User; token: string; session: Session }>();
  const operator = (phone = "+919000000001") => {
    let a = ops.get(phone);
    if (!a) { a = login(phone); ops.set(phone, a); }
    if (a.session.stepUpUntil < clock.now().getTime()) {
      p.requestOtp(phone, "stepup" + phone);
      p.stepUp(a.session, a.user, otps.get(phone) as string);
    }
    return a;
  };
  /** Approve a claim of the given type for a user via an operator. */
  const verify = (user: User, type: "PERSON_IDENTITY" | "ORGANIZATION_EXISTENCE" | "PRICE_CONTRIBUTOR_SCOPE", scope: Record<string, string> = {}, ops = operator("+919000000001")) => {
    const c = p.submitClaim(user, type, scope, ["doc"]);
    return p.decideClaim(ops.user, ops.session, c.claimId, "APPROVED", "DOCS_OK");
  };
  return { p, clock, otps, login, operator, verify };
}

export const hoursFromNow = (clock: FakeClock, h: number) => new Date(clock.now().getTime() + h * 3_600_000).toISOString();

export const sampleTerms = (over: Partial<OfferTerms> = {}): OfferTerms => ({
  quantity: "5000", unit: "NUT", unitPricePaise: 3000, gradeGroup: "FAQ", fulfilmentMode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: ["TRANSPORT"],
  weighmentMethod: "COUNT", weighmentLocation: "Farm", paymentMethod: "UPI", paymentDue: "ON_LOADING",
  fulfilmentFrom: "2026-10-02T04:00:00Z", fulfilmentBy: "2026-10-05T12:00:00Z", acceptanceWindowHours: 24, inspectionTerms: "Buyer may inspect at loading", ...over,
});
