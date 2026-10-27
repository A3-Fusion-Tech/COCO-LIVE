import { reputationSummary, type ParticipantState, type ReputationEvent } from "@livecoco/domain";
import { C, L } from "../../core/collections.ts";
import type { Scope } from "../../core/scope.ts";
import type { IdentityService } from "../identity/identity.service.ts";

/** Append-only reputation events and the public summary derived from them. */
export class Reputation {
  record(s: Scope, partyId: string, type: ReputationEvent["type"], dealId: string) {
    s.tx.append(L.reputation, { partyId, type, dealId, at: s.iso() } satisfies ReputationEvent);
  }
  forParty(s: Scope, partyId: string, type?: ReputationEvent["type"]) { return s.tx.findLog<ReputationEvent>(L.reputation, { partyId, ...(type ? { type } : {}) }); }
  async publicSummary(s: Scope, partyId: string) { return reputationSummary(await this.forParty(s, partyId), partyId); }
}

/** The facts about a party that listing review and matching depend on. */
export class Participants {
  private readonly identity: IdentityService;
  private readonly reputation: Reputation;

  constructor(identity: IdentityService, reputation: Reputation) {
    this.identity = identity;
    this.reputation = reputation;
  }

  async state(s: Scope, userId: string): Promise<ParticipantState> {
    const u = await this.identity.user(s, userId);
    const completed = await this.reputation.forParty(s, userId, "DEAL_COMPLETED");
    return { active: !!u, suspended: u?.suspended ?? true, blocked: u?.blocked ?? [], claims: await this.identity.approvedClaimTypes(s, userId), completedDeals: completed.length };
  }

  /** True when the seller has completed a deal with this buyer before. */
  async havePriorDeal(s: Scope, sellerId: string, buyerId: string) {
    for (const e of await this.reputation.forParty(s, sellerId, "DEAL_COMPLETED")) {
      const d = await s.tx.get<{ buyerId: string }>(C.deals, e.dealId);
      if (d?.buyerId === buyerId) return true;
    }
    return false;
  }
}
