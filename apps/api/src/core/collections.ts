/** Logical names of the document collections and append-only logs (see packages/database/src/pg.ts). */
export const C = {
  users: "users", sessions: "sessions", otps: "otps", otpRequests: "otp_requests", orgs: "organizations", claims: "verification_claims",
  evidence: "evidence", raw: "raw_records", observations: "price_observations", aggregates: "price_aggregates", sourceHealth: "source_health",
  alerts: "alert_subscriptions", queue: "ops_queue", lots: "sell_lots", requirements: "buy_requirements", templates: "recurrence_templates",
  threads: "negotiation_threads", offers: "offers", deals: "deals", disputes: "disputes", disputeBefore: "dispute_prior_status",
  idempotency: "idempotency_keys", partners: "partners", inspections: "inspections", transportRequests: "transport_requests",
  transportQuotes: "transport_quotes", memberLots: "member_lots", aggregateLots: "aggregate_lots", settlements: "settlements", media: "media",
  outbox: "outbox",
} as const;

export const L = {
  audit: "audit_log", notifications: "notifications", reputation: "reputation_events", reveals: "contact_reveals", reports: "user_reports",
} as const;
