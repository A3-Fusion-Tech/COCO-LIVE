import { LiveCoco, type AppConfig, type Scope, type Services, type User } from "@livecoco/api";
import { MemoryStore, type Store } from "@livecoco/database";
import type { OfferTerms } from "@livecoco/domain";

export class FakeClock {
  private t = Date.parse("2026-10-01T06:00:00Z");
  now = () => new Date(this.t);
  advanceHours(h: number) { this.t += h * 3_600_000; }
  advanceMinutes(m: number) { this.t += m * 60_000; }
}

export const OPS_CAPS = ["ops.price_review", "ops.source_health", "ops.verification", "ops.listings", "ops.disputes", "ops.audit", "ops.sensitive_documents"] as const;

/** A signed-in test participant: the bearer token, plus the user as it was at sign-in. */
export interface Login { token: string; user: User }

/** Each service's methods with the leading Scope removed: every call runs as its own unit of work. */
type Bound<T> = { [K in keyof T]: T[K] extends (s: Scope, ...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };
export type Client = { [K in keyof Services]: Bound<Services[K]> };

export function makeWorld(extra: Partial<AppConfig> = {}, store: Store = new MemoryStore()) {
  const clock = new FakeClock();
  const otps = new Map<string, string>();
  const app = new LiveCoco({ clock: clock.now, deliverOtp: (ph, c) => otps.set(ph, c), operators: { "+919000000001": [...OPS_CAPS], "+919000000002": [...OPS_CAPS] }, ...extra }, store);

  const client = (token?: string): Client => new Proxy({} as Client, {
    get: (_t, name: string) => new Proxy({}, {
      get: (_u, method: string) => (...args: unknown[]) => app.run((s) => {
        const svc = app.services[name as keyof Services] as unknown as Record<string, (s: Scope, ...a: unknown[]) => unknown>;
        return Promise.resolve(svc[method]!.call(svc, s, ...args));
      }, token === undefined ? {} : { token }),
    }),
  });
  /** Calls services as this participant. */
  const as = (who: Login) => client(who.token);
  /** Calls services with no actor (worker / system work). */
  const sys = client();
  /** Direct access to a unit of work, for inspecting stored state. */
  const run = <T>(fn: (s: Scope) => Promise<T>) => app.run(fn);

  let n = 0;
  const login = async (phone: string, device = `dev${++n}`): Promise<Login> => {
    await sys.identity.requestOtp(phone, device);
    const { token, user } = await sys.identity.verifyOtp(phone, otps.get(phone.startsWith("+") ? phone : `+91${phone}`) as string, device);
    return { token, user };
  };
  const ops = new Map<string, Login>();
  /** A signed-in operator with a fresh step-up. */
  const operator = async (phone = "+919000000001") => {
    let a = ops.get(phone);
    if (!a) { a = await login(phone); ops.set(phone, a); }
    if (!(await run(async (s) => { s.actor = await app.services.identity.authenticate(s, a!.token); return app.services.identity.hasStepUp(s); }))) {
      await sys.identity.requestOtp(phone, "stepup" + phone);
      await as(a).identity.stepUp(otps.get(phone) as string);
    }
    return a;
  };
  /** Has an operator approve a claim of the given type for a participant. */
  const verify = async (who: Login, type: "PERSON_IDENTITY" | "ORGANIZATION_EXISTENCE" | "PRICE_CONTRIBUTOR_SCOPE", scope: Record<string, string> = {}, by?: Login) => {
    const c = await as(who).identity.submitClaim(type, scope, ["doc"]);
    return as(by ?? (await operator())).identity.decideClaim(c.claimId, "APPROVED", "DOCS_OK");
  };
  /** Reads a stored document. */
  const get = <T>(coll: string, key: string) => run((s) => s.tx.get<T>(coll, key));
  const find = <T>(coll: string, match: Record<string, unknown> = {}) => run((s) => s.tx.find<T>(coll, match));
  const log = <T>(name: string, match: Record<string, unknown> = {}) => run((s) => s.tx.findLog<T>(name, match));

  return { app, clock, otps, as, sys, run, login, operator, verify, get, find, log };
}
export type World = ReturnType<typeof makeWorld>;

export const hoursFromNow = (clock: FakeClock, h: number) => new Date(clock.now().getTime() + h * 3_600_000).toISOString();

export const sampleTerms = (over: Partial<OfferTerms> = {}): OfferTerms => ({
  quantity: "5000", unit: "NUT", unitPricePaise: 3000, gradeGroup: "FAQ", fulfilmentMode: "PICKUP", costsIncluded: ["LOADING"], costsExcluded: ["TRANSPORT"],
  weighmentMethod: "COUNT", weighmentLocation: "Farm", paymentMethod: "UPI", paymentDue: "ON_LOADING",
  fulfilmentFrom: "2026-10-02T04:00:00Z", fulfilmentBy: "2026-10-05T12:00:00Z", acceptanceWindowHours: 24, inspectionTerms: "Buyer may inspect at loading", ...over,
});
