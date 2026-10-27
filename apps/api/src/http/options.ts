import type { Logger, Metrics } from "@livecoco/observability";
import type { LiveCoco } from "../app.ts";

export interface ApiOptions {
  app: LiveCoco;
  /** Trust x-forwarded-for from the web gateway (set only when the API is not directly reachable). */
  trustProxy?: boolean;
  logger?: Logger;
  metrics?: Metrics;
  maxBodyBytes?: number;
  requestsPerMinute?: number;
}

/** Nest injection token for the resolved API options. */
export const API_OPTIONS = Symbol("API_OPTIONS");
