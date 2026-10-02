import type { Logger, Metrics } from "../../../../packages/observability/src/index.ts";
import type { PgStore } from "../../../../packages/database/src/pg.ts";
import type { Platform } from "../platform.ts";

export interface ApiOptions {
  platform: Platform;
  /** Trust x-forwarded-for from the web gateway (set only when the API is not directly reachable). */
  trustProxy?: boolean;
  store?: PgStore;
  internalToken?: string;
  logger?: Logger;
  metrics?: Metrics;
  maxBodyBytes?: number;
  requestsPerMinute?: number;
}

/** Nest injection token for the resolved API options. */
export const API_OPTIONS = Symbol("API_OPTIONS");
