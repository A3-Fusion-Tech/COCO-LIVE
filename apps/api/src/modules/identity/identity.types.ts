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
/** Stored under the SHA-256 of the bearer token; the token itself is never persisted. */
export interface Session { token: string; userId: string; createdAt: string; stepUpUntil: number; revoked: boolean; device: string }
export interface OtpRecord { hash: string; expires: number; attempts: number; used: boolean }

export type OrgKind = "FARMER_GROUP" | "FPO" | "TRADER" | "PROCESSOR" | "BUYER" | "INSPECTION_PARTNER" | "LOGISTICS_PARTNER";
export type OrgRole = "OWNER" | "MEMBER" | "FINANCE" | "VERIFIER";
export interface Organization { organizationId: string; name: string; kind: OrgKind; members: { userId: string; role: OrgRole }[] }

export type ClaimType = "MOBILE_CONTROL" | "PERSON_IDENTITY" | "ORGANIZATION_EXISTENCE" | "ORGANIZATION_MEMBERSHIP" | "BUSINESS_DOCUMENT" | "FSSAI_DOCUMENT" | "GST_DOCUMENT" | "MARKET_LICENSE_DOCUMENT" | "PAYMENT_DESTINATION" | "PRICE_CONTRIBUTOR_SCOPE" | "LOT_STOCK";
export type ClaimStatus = "NOT_STARTED" | "EVIDENCE_REQUESTED" | "SUBMITTED" | "IN_REVIEW" | "NEEDS_MORE_INFORMATION" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
export interface VerificationClaim { claimId: string; userId: string; type: ClaimType; scope: Record<string, string>; status: ClaimStatus; evidenceIds: string[]; verifiedAt: string | undefined; expiresAt: string | undefined; decidedBy: string | undefined; reasonCode: string | undefined }
export interface Evidence { evidenceId: string; ownerId: string; dealId: string | undefined; kind: string; visibleTo: string[]; note: string; at: string; sensitive: boolean }

export interface IdentityConfig {
  /** phone → capabilities granted on first sign-in. */
  operators: Record<string, Capability[]>;
  otpTtlMs: number;
  otpMaxPerHour: number;
  /** Per client address (shared NAT is common, so this is looser than the per-phone limit). */
  otpMaxPerHourPerDevice: number;
  stepUpMs: number;
  /** OTP delivery seam: the console provider in development, an SMS provider in production. */
  deliverOtp: (phone: string, code: string) => void;
}
