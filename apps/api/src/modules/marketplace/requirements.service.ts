import {
  MARKETS, forbidden, instantiateRecurrence, invalid, matchLotToRequirement, notFound, rankMatches, validateRequirement,
  type BuyRequirement, type Cadence, type MatchCandidate, type ProductId, type RecurrenceTemplate, type SellLot, type Unit,
} from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { LotsService } from "./lots.service.ts";
import type { Participants } from "./participants.ts";

export interface RequirementInput {
  organizationId?: string; productId: ProductId; gradeAttributes?: Record<string, string>; gradeGroup: string; unit: Unit;
  targetQuantity: string; minQuantity?: string; partialAllowed?: boolean; destinationMarketId: string; maxRadiusKm: number;
  requiredFrom: string; requiredBy: string; expiresAt: string; maxUnitPricePaise?: number; requiredClaims?: string[];
}
type RequirementBase = Omit<BuyRequirement, "requirementId" | "status" | "version" | "fulfilledQuantity" | "recurrenceTemplateId">;

/** Buyer requirements (one-off and recurring) and lot ↔ requirement matching. */
export class RequirementsService {
  private readonly identity: IdentityService;
  private readonly lots: LotsService;
  private readonly participants: Participants;

  constructor(identity: IdentityService, lots: LotsService, participants: Participants) {
    this.identity = identity;
    this.lots = lots;
    this.participants = participants;
  }

  async get(s: Scope, id: string) { return orNotFound(await s.tx.get<BuyRequirement>(C.requirements, id), "Requirement"); }
  save(s: Scope, r: BuyRequirement) { return s.tx.put(C.requirements, r.requirementId, r); }
  mine(s: Scope) { return s.tx.find<BuyRequirement>(C.requirements, { buyerId: s.user.userId }); }

  private async base(s: Scope, input: RequirementInput): Promise<RequirementBase> {
    if (!(await this.identity.isVerifiedParty(s, s.user.userId))) throw forbidden("Buyer verification required to publish a requirement");
    await this.identity.assertOrgMember(s, input.organizationId);
    const m = MARKETS[input.destinationMarketId];
    if (!m) throw invalid("UNKNOWN_MARKET", "Unknown destination market");
    return {
      buyerId: s.user.userId, organizationId: input.organizationId, productId: input.productId, gradeAttributes: input.gradeAttributes ?? {}, gradeGroup: input.gradeGroup, unit: input.unit,
      targetQuantity: input.targetQuantity, minQuantity: input.minQuantity ?? input.targetQuantity, partialAllowed: input.partialAllowed ?? false, destination: { marketId: m.marketId, lat: m.lat, lon: m.lon },
      maxRadiusKm: input.maxRadiusKm, requiredFrom: input.requiredFrom, requiredBy: input.requiredBy, expiresAt: input.expiresAt, maxUnitPricePaise: input.maxUnitPricePaise, requiredClaims: input.requiredClaims ?? [],
    };
  }

  async create(s: Scope, input: RequirementInput): Promise<BuyRequirement> {
    const r: BuyRequirement = { ...(await this.base(s, input)), requirementId: uid("req"), fulfilledQuantity: "0", recurrenceTemplateId: undefined, status: "ACTIVE", version: 1 };
    const issues = validateRequirement(r, s.now());
    if (issues.length) throw invalid("REQUIREMENT_INVALID", issues.join(", "));
    return this.save(s, r);
  }

  async createRecurring(s: Scope, input: RequirementInput, cadence: Cadence, occurrences: number) {
    const base = await this.base(s, input);
    if (occurrences < 2 || occurrences > 52) throw invalid("OCCURRENCES_INVALID", "2–52 occurrences");
    const template: RecurrenceTemplate = { templateId: uid("tpl"), cadence, occurrences, base };
    const instances = instantiateRecurrence(template, () => uid("req"));
    for (const r of instances) {
      const issues = validateRequirement(r, new Date(Date.parse(r.expiresAt) - 1));
      if (issues.length) throw invalid("REQUIREMENT_INVALID", issues.join(", "));
    }
    s.tx.put(C.templates, template.templateId, template);
    for (const r of instances) this.save(s, r);
    return { template, instances };
  }

  /** Editing a template only affects instances generated afterwards (as drafts). */
  async extendRecurrence(s: Scope, templateId: string, patch: { targetQuantity?: string; minQuantity?: string; maxUnitPricePaise?: number }, more: number) {
    const t = await s.tx.get<RecurrenceTemplate>(C.templates, templateId);
    if (!t || t.base.buyerId !== s.user.userId) throw notFound("Template");
    const existing = await s.tx.find<BuyRequirement>(C.requirements, { recurrenceTemplateId: templateId });
    const next: RecurrenceTemplate = { ...t, base: { ...t.base, ...patch }, occurrences: t.occurrences + more };
    s.tx.put(C.templates, templateId, next);
    const fresh = instantiateRecurrence(next, () => uid("req")).slice(existing.length).map((r) => ({ ...r, status: "DRAFT" as const }));
    for (const r of fresh) this.save(s, r);
    return fresh;
  }

  async close(s: Scope, id: string) {
    const r = await this.get(s, id);
    if (r.buyerId !== s.user.userId) throw notFound("Requirement");
    return this.save(s, { ...r, status: "CLOSED", version: r.version + 1 });
  }

  async expire(s: Scope) {
    let n = 0;
    for (const r of await s.tx.find<BuyRequirement>(C.requirements, { status: "ACTIVE" })) if (Date.parse(r.expiresAt) <= s.ms()) { this.save(s, { ...r, status: "EXPIRED", version: r.version + 1 }); n++; }
    return n;
  }

  // ---- matching ------------------------------------------------------------------------------
  private async pair(s: Scope, l: SellLot, r: BuyRequirement) {
    return matchLotToRequirement(l, r, await this.participants.state(s, l.sellerId), await this.participants.state(s, r.buyerId), this.lots.location(l), s.now(), await this.participants.havePriorDeal(s, l.sellerId, r.buyerId));
  }

  /** Candidate lots for a requirement; operators also see ineligible ones with their reasons. */
  private async lotsFor(s: Scope, r: BuyRequirement, includeIneligible: boolean): Promise<MatchCandidate[]> {
    const all: MatchCandidate[] = [];
    for (const l of includeIneligible ? await s.tx.find<SellLot>(C.lots, { productId: r.productId }) : await this.lots.discoverable(s, { productId: r.productId })) all.push(await this.pair(s, l, r));
    return includeIneligible ? all.sort((a, b) => b.score - a.score) : rankMatches(all);
  }

  async matchesForRequirement(s: Scope, requirementId: string) {
    const r = await this.get(s, requirementId);
    if (r.buyerId !== s.user.userId) throw notFound("Requirement");
    return this.lotsFor(s, r, false);
  }

  async operatorMatches(s: Scope, requirementId: string) {
    this.identity.require(s, "ops.listings");
    return this.lotsFor(s, await this.get(s, requirementId), true);
  }

  async matchesForLot(s: Scope, lotId: string) {
    const l = await this.lots.own(s, lotId);
    const all: MatchCandidate[] = [];
    for (const r of await s.tx.find<BuyRequirement>(C.requirements, { productId: l.productId, status: "ACTIVE" })) all.push(await this.pair(s, l, r));
    return rankMatches(all).map((c) => ({ ...c, incompatibilities: [] }));
  }
}
