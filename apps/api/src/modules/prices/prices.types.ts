export interface RawRecord { rawId: string; source: string; hash: string; payload: Record<string, unknown>; receivedAt: string; parserVersion: string; parsed: boolean; unmapped: string[] }

export interface SourceHealthRecord {
  source: string; lastAttemptAt: string | undefined; lastSuccessAt: string | undefined; lastError: string | undefined; lastObservationAt: string | undefined;
  retrieved: number; normalized: number; unmapped: number; rejected: number; disabled: boolean; consecutiveFailures: number;
}
export type SourceStatus = "HEALTHY" | "DELAYED" | "STALE" | "DEGRADED" | "DISABLED";

/** One price bucket's published aggregates, oldest first (stored in price_aggregates, keyed by bucket). */
export interface PriceHistory { bucket: string; history: import("@livecoco/domain").Aggregate[] }

export interface IngestResult { stored: number; duplicates: number; observations: number; unmapped: number }

export interface PriceFilter { productId?: string; marketId?: string; stage?: string; unit?: string; gradeGroup?: string }
