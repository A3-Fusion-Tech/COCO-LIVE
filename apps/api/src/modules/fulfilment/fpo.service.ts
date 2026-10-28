import { addQuantity, compareQuantity, conflict, currentCard, estimateTotalPaise, forbidden, fromMilli, invalid, notFound, toMilli, type SellLot, type Unit } from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { AuditLog } from "../../core/audit.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { OrgRole } from "../identity/identity.types.ts";
import type { DealsService } from "../deals/deals.service.ts";
import type { LotsService } from "../marketplace/lots.service.ts";
import type { AggregateLot, MemberLot, Settlement, SettlementLine } from "./fulfilment.types.ts";

const ALL_ROLES: OrgRole[] = ["OWNER", "MEMBER", "FINANCE", "VERIFIER"];

/** Largest-remainder apportionment: shares sum exactly to `total`, deterministic on ties. */
export function apportion(total: number, weights: { id: string; weight: bigint }[]): Map<string, number> {
  const sum = weights.reduce((a, w) => a + w.weight, 0n);
  if (sum <= 0n) throw invalid("NO_WEIGHT", "Nothing to apportion");
  const t = BigInt(total);
  const parts = weights.map((w) => ({ id: w.id, base: (t * w.weight) / sum, rem: (t * w.weight) % sum }));
  const left = Number(t - parts.reduce((a, x) => a + x.base, 0n));
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.id.localeCompare(b.id) : a.rem > b.rem ? -1 : 1));
  const extra = new Set(order.slice(0, left).map((x) => x.id));
  return new Map(parts.map((x) => [x.id, Number(x.base) + (extra.has(x.id) ? 1 : 0)]));
}

/** FPO / farmer-group aggregation: member lots → one marketable sell lot → per-member settlement after the deal. */
export class FpoService {
  private readonly identity: IdentityService;
  private readonly lots: LotsService;
  private readonly deals: DealsService;
  private readonly audit: AuditLog;

  constructor(identity: IdentityService, lots: LotsService, deals: DealsService, audit: AuditLog) {
    this.identity = identity;
    this.lots = lots;
    this.deals = deals;
    this.audit = audit;
  }

  private async manager(s: Scope, organizationId: string, roles = ALL_ROLES) {
    const org = await this.identity.requireOrg(s, organizationId);
    const m = org.members.find((x) => x.userId === s.user.userId);
    if (!m || !roles.includes(m.role)) throw forbidden();
    if (org.kind !== "FPO" && org.kind !== "FARMER_GROUP") throw invalid("NOT_AN_FPO", "Only FPO / farmer-group organizations aggregate member lots");
    return org;
  }
  private async memberLot(s: Scope, id: string) { return orNotFound(await s.tx.get<MemberLot>(C.memberLots, id), "Member lot"); }
  private saveMemberLot(s: Scope, m: MemberLot) { return s.tx.put(C.memberLots, m.memberLotId, m); }

  async memberLots(s: Scope, organizationId: string) {
    if (!(await this.identity.isMember(s, organizationId, s.user.userId))) throw notFound();
    return s.tx.find<MemberLot>(C.memberLots, { organizationId });
  }

  async addMemberLot(s: Scope, organizationId: string, input: { memberName: string; memberUserId?: string; productId: string; gradeGroup: string; unit: Unit; quantity: string; originMarketId: string; quality?: Record<string, string> }): Promise<MemberLot> {
    await this.manager(s, organizationId);
    if (!input.memberName.trim()) throw invalid("MEMBER_REQUIRED", "Member name is required");
    if (toMilli(input.quantity) <= 0n) throw invalid("QUANTITY_NOT_POSITIVE", "Quantity must be positive");
    return this.saveMemberLot(s, {
      memberLotId: uid("mlot"), organizationId, memberName: input.memberName.trim(), memberUserId: input.memberUserId, productId: input.productId, gradeGroup: input.gradeGroup,
      unit: input.unit, quantity: input.quantity, originMarketId: input.originMarketId, quality: input.quality ?? {}, status: "PENDING_REVIEW", createdBy: s.user.userId,
      reviewedBy: undefined, aggregateLotId: undefined, version: 1,
    });
  }

  /** Four-eyes: when the organisation has more than one member, the creator cannot review their own entry. */
  async reviewMemberLot(s: Scope, memberLotId: string, approve: boolean): Promise<MemberLot> {
    const m = await this.memberLot(s, memberLotId);
    const org = await this.manager(s, m.organizationId, ["OWNER", "VERIFIER"]);
    if (m.status !== "PENDING_REVIEW") throw conflict("INVALID_TRANSITION", `Member lot is ${m.status}`);
    if (m.createdBy === s.user.userId && org.members.length > 1) throw forbidden("A different manager must review this member lot");
    return this.saveMemberLot(s, { ...m, status: approve ? "APPROVED" : "REJECTED", reviewedBy: s.user.userId, version: m.version + 1 });
  }

  /** Compatible member lots become one marketable sell lot, keeping the member ownership mapping. */
  async buildAggregate(s: Scope, organizationId: string, input: { memberLotIds: string[]; tolerancePercent?: number; availableFrom: string; availableTo: string; expiresAt: string; fulfilment: SellLot["fulfilment"]; priceExpectation: SellLot["priceExpectation"]; partialFulfilmentAllowed?: boolean }) {
    await this.manager(s, organizationId, ["OWNER", "VERIFIER"]);
    if (!input.memberLotIds.length) throw invalid("NO_MEMBER_LOTS", "Select at least one member lot");
    if (new Set(input.memberLotIds).size !== input.memberLotIds.length) throw invalid("DUPLICATE_MEMBER_LOT", "A member lot appears twice");
    const lots: MemberLot[] = [];
    for (const id of input.memberLotIds) lots.push(await this.memberLot(s, id));
    const first = lots[0] as MemberLot;
    const errors: string[] = [];
    for (const l of lots) {
      if (l.organizationId !== organizationId) errors.push(`${l.memberLotId}:OTHER_ORGANIZATION`);
      if (l.status !== "APPROVED") errors.push(`${l.memberLotId}:NOT_APPROVED(${l.status})`);
      if (l.productId !== first.productId) errors.push(`${l.memberLotId}:PRODUCT_MISMATCH`);
      if (l.gradeGroup !== first.gradeGroup) errors.push(`${l.memberLotId}:GRADE_MISMATCH`);
      if (l.unit !== first.unit) errors.push(`${l.memberLotId}:UNIT_MISMATCH`);
    }
    if (errors.length) throw invalid("INCOMPATIBLE_MEMBER_LOTS", errors.join(", "));
    const total = lots.reduce((a, l) => addQuantity(a, l.quantity), "0");
    const attrs: Record<string, string> = {};
    for (const l of lots) for (const [k, v] of Object.entries(l.quality)) attrs[k] = attrs[k] === undefined || attrs[k] === v ? v : "MIXED";
    const sellLot = await this.lots.create(s, {
      organizationId, productId: first.productId as SellLot["productId"], gradeAttributes: attrs, gradeGroup: first.gradeGroup, unit: first.unit, quantityTotal: total,
      partialFulfilmentAllowed: input.partialFulfilmentAllowed ?? true, originMarketId: first.originMarketId, availableFrom: input.availableFrom, availableTo: input.availableTo,
      expiresAt: input.expiresAt, fulfilment: input.fulfilment, priceExpectation: input.priceExpectation,
    });
    const aggregate: AggregateLot = { aggregateLotId: uid("agg"), organizationId, sellLotId: sellLot.sellLotId, tolerancePercent: input.tolerancePercent ?? 2, contributions: lots.map((l) => ({ memberLotId: l.memberLotId, memberName: l.memberName, quantity: l.quantity })), totalQuantity: total, createdBy: s.user.userId, createdAt: s.iso() };
    s.tx.put(C.aggregateLots, aggregate.aggregateLotId, aggregate);
    for (const l of lots) this.saveMemberLot(s, { ...l, status: "AGGREGATED", aggregateLotId: aggregate.aggregateLotId, version: l.version + 1 });
    this.audit.record(s, s.user.userId, "AGGREGATE_BUILT", aggregate.aggregateLotId, undefined, { members: lots.length, total });
    return { aggregate, sellLot };
  }

  // ---- settlements ---------------------------------------------------------------------------
  /** Deal outcome → per-member payables. Quantity and price come from the immutable Deal Card and the delivery event. */
  async draftSettlement(s: Scope, dealId: string, deductions: { type: string; amountPaise: number }[] = []): Promise<Settlement> {
    const d = await this.deals.get(s, dealId);
    const agg = (await s.tx.find<AggregateLot>(C.aggregateLots, { sellLotId: d.sellLotId }))[0];
    if (!agg) throw invalid("NOT_AN_AGGREGATE_DEAL", "This deal was not made from an aggregate lot");
    await this.manager(s, agg.organizationId, ["OWNER", "FINANCE"]);
    if (!["ACCEPTED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(d.status)) throw conflict("DEAL_NOT_SETTLEABLE", `Deal is ${d.status}; settle after the buyer accepts delivery`);
    if ((await s.tx.find<Settlement>(C.settlements, { dealId })).length) throw conflict("SETTLEMENT_EXISTS", "A settlement already exists for this deal");
    for (const x of deductions) if (!Number.isSafeInteger(x.amountPaise) || x.amountPaise < 0 || !x.type) throw invalid("INVALID_DEDUCTION", "Deductions need a type and non-negative integer paise");
    const card = currentCard(d);
    const delivered = [...d.events].reverse().find((e) => e.type === "DELIVERED");
    const accepted = String(delivered?.data?.actualQuantity ?? card.terms.quantity);
    if (compareQuantity(accepted, card.terms.quantity) > 0) {
      const tolerance = (Number(toMilli(card.terms.quantity)) * agg.tolerancePercent) / 100;
      if (Number(toMilli(accepted)) - Number(toMilli(card.terms.quantity)) > tolerance) throw invalid("OVER_TOLERANCE", "Delivered quantity exceeds the agreed quantity plus tolerance");
    }
    const gross = estimateTotalPaise(accepted, card.terms.unitPricePaise);
    const deductionTotal = deductions.reduce((a, x) => a + x.amountPaise, 0);
    if (deductionTotal > gross) throw invalid("DEDUCTIONS_EXCEED_GROSS", "Deductions exceed the gross amount");
    // Members are paid in proportion to what they contributed to the aggregate.
    const weights = agg.contributions.map((c) => ({ id: c.memberLotId, weight: toMilli(c.quantity) }));
    const grossShares = apportion(gross, weights);
    const dedShares = apportion(deductionTotal, weights);
    const qtyShares = apportion(Number(toMilli(accepted)), weights);
    const lines: SettlementLine[] = agg.contributions.map((c) => {
      const g = grossShares.get(c.memberLotId) as number, dd = dedShares.get(c.memberLotId) as number;
      return { memberLotId: c.memberLotId, memberName: c.memberName, quantity: fromMilli(BigInt(qtyShares.get(c.memberLotId) as number)), grossPaise: g, deductionPaise: dd, netPaise: g - dd };
    });
    if (lines.some((l) => l.netPaise < 0)) throw invalid("NEGATIVE_PAYABLE", "A member payable would be negative");
    const settlement: Settlement = {
      settlementId: uid("set"), dealId, aggregateLotId: agg.aggregateLotId, organizationId: agg.organizationId, status: "DRAFT", acceptedQuantity: accepted, unitPricePaise: card.terms.unitPricePaise,
      grossPaise: gross, deductions, deductionTotalPaise: deductionTotal, netPaise: gross - deductionTotal, lines, createdBy: s.user.userId, approvedBy: undefined, approvedAt: undefined, createdAt: s.iso(), version: 1,
    };
    return s.tx.put(C.settlements, settlement.settlementId, settlement);
  }

  async settlement(s: Scope, id: string) {
    const st = await s.tx.get<Settlement>(C.settlements, id);
    if (!st || !(await this.identity.isMember(s, st.organizationId, s.user.userId))) throw notFound();
    return st;
  }

  /** Four-eyes: approval needs a different OWNER/FINANCE manager than the drafter, when one exists. */
  async approveSettlement(s: Scope, settlementId: string): Promise<Settlement> {
    const st = orNotFound(await s.tx.get<Settlement>(C.settlements, settlementId), "Settlement");
    const org = await this.manager(s, st.organizationId, ["OWNER", "FINANCE"]);
    if (st.status !== "DRAFT") throw conflict("INVALID_TRANSITION", `Settlement is ${st.status}`);
    if (st.createdBy === s.user.userId && org.members.filter((m) => m.role === "OWNER" || m.role === "FINANCE").length > 1) throw forbidden("A second manager must approve this settlement");
    const approved = s.tx.put(C.settlements, settlementId, { ...st, status: "APPROVED" as const, approvedBy: s.user.userId, approvedAt: s.iso(), version: st.version + 1 });
    this.deals.event(s, await this.deals.get(s, st.dealId), "SETTLEMENT_APPROVED", s.user.userId, { settlementId });
    this.audit.record(s, s.user.userId, "SETTLEMENT_APPROVED", settlementId);
    return approved;
  }

  /** CSV for the FPO's accountant; cells are neutralised against spreadsheet formula injection. */
  async exportSettlementCsv(s: Scope, settlementId: string): Promise<string> {
    const st = orNotFound(await s.tx.get<Settlement>(C.settlements, settlementId), "Settlement");
    await this.manager(s, st.organizationId, ["OWNER", "FINANCE"]);
    if (st.status !== "APPROVED") throw conflict("NOT_APPROVED", "Only approved settlements can be exported");
    const csv = (v: string | number) => { const t = String(v).replace(/^([=+\-@])/, "'$1"); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const rupees = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
    const rows = [["settlementId", "dealId", "member", "memberLotId", "quantity", "gross_inr", "deductions_inr", "net_inr"].join(",")];
    for (const l of st.lines) rows.push([st.settlementId, st.dealId, l.memberName, l.memberLotId, l.quantity, rupees(l.grossPaise), rupees(l.deductionPaise), rupees(l.netPaise)].map(csv).join(","));
    rows.push(["TOTAL", st.dealId, "", "", st.acceptedQuantity, rupees(st.grossPaise), rupees(st.deductionTotalPaise), rupees(st.netPaise)].map(csv).join(","));
    this.audit.record(s, s.user.userId, "SETTLEMENT_EXPORTED", settlementId);
    return rows.join("\n") + "\n";
  }
}
