import type { Unit } from "@livecoco/domain";

export interface Partner { partnerId: string; organizationId: string; kind: "INSPECTION" | "LOGISTICS"; serviceMarketIds: string[]; status: "PENDING" | "APPROVED" | "SUSPENDED" | "REJECTED"; decidedBy: string | undefined; reason: string | undefined; createdAt: string }

export type InspectionStatus = "REQUESTED" | "SCHEDULED" | "COMPLETED" | "DECIDED" | "CANCELLED";
export interface InspectionResult { outcome: "PASS" | "FAIL" | "CONDITIONAL"; measurements: Record<string, number>; note: string }
export interface Inspection {
  inspectionId: string; dealId: string; requestedBy: string; partnerId: string; status: InspectionStatus; scheduledAt: string; location: string;
  requestedAt: string; acceptedAt: string | undefined; completedAt: string | undefined; result: InspectionResult | undefined;
  decision: { by: string; accept: boolean; at: string } | undefined; version: number;
}

export type TransportStatus = "OPEN" | "BOOKED" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
export interface TransportRequest {
  requestId: string; dealId: string; requestedBy: string; pickupMarketId: string; destinationMarketId: string; weightKg: number; windowFrom: string; windowTo: string;
  status: TransportStatus; bookedQuoteId: string | undefined; partnerId: string | undefined; vehicle: { registration: string; driverPhone: string } | undefined;
  statusLog: { status: TransportStatus; at: string; note: string }[]; openedAt: string; deliveredAt: string | undefined;
}
export interface TransportQuote { quoteId: string; requestId: string; partnerId: string; pricePaise: number; vehicleType: string; etaFrom: string; etaTo: string; validUntil: string; status: "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED"; respondedAt: string; referralFeeBps: number }

export interface MemberLot {
  memberLotId: string; organizationId: string; memberName: string; memberUserId: string | undefined; productId: string; gradeGroup: string; unit: Unit; quantity: string;
  originMarketId: string; quality: Record<string, string>; status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "AGGREGATED" | "RELEASED"; createdBy: string; reviewedBy: string | undefined; aggregateLotId: string | undefined; version: number;
}
export interface AggregateLot { aggregateLotId: string; organizationId: string; sellLotId: string; tolerancePercent: number; contributions: { memberLotId: string; memberName: string; quantity: string }[]; totalQuantity: string; createdBy: string; createdAt: string }

export interface SettlementLine { memberLotId: string; memberName: string; quantity: string; grossPaise: number; deductionPaise: number; netPaise: number }
export interface Settlement {
  settlementId: string; dealId: string; aggregateLotId: string; organizationId: string; status: "DRAFT" | "APPROVED"; acceptedQuantity: string; unitPricePaise: number;
  grossPaise: number; deductions: { type: string; amountPaise: number }[]; deductionTotalPaise: number; netPaise: number; lines: SettlementLine[];
  createdBy: string; approvedBy: string | undefined; approvedAt: string | undefined; createdAt: string; version: number;
}
