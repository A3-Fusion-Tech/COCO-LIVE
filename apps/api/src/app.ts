import { MemoryStore, type Store } from "@livecoco/database";
import { newCorrelationId } from "@livecoco/observability";
import { AuditLog, WorkQueue } from "./core/audit.ts";
import { Idempotency } from "./core/idempotency.ts";
import { Notifier } from "./core/notifier.ts";
import { Scope } from "./core/scope.ts";
import { DealsService } from "./modules/deals/deals.service.ts";
import { FpoService } from "./modules/fulfilment/fpo.service.ts";
import { PartnersService } from "./modules/fulfilment/partners.service.ts";
import { IdentityService } from "./modules/identity/identity.service.ts";
import type { IdentityConfig } from "./modules/identity/identity.types.ts";
import { LotsService } from "./modules/marketplace/lots.service.ts";
import { OffersService } from "./modules/marketplace/offers.service.ts";
import { Participants, Reputation } from "./modules/marketplace/participants.ts";
import { RequirementsService } from "./modules/marketplace/requirements.service.ts";
import { MediaService, MemoryBlobStore, type BlobStore } from "./modules/media/media.service.ts";
import { MaintenanceService } from "./modules/operations/maintenance.service.ts";
import { OperationsService } from "./modules/operations/operations.service.ts";
import { AlertsService } from "./modules/prices/alerts.service.ts";
import { PricesService } from "./modules/prices/prices.service.ts";

export interface AppConfig extends IdentityConfig {
  clock: () => Date;
  contactRevealPerDay: number;
  blobs: BlobStore;
  uploadSecret: string;
  /** Public base URL of the API, used in signed upload links. */
  baseUrl: string;
}

export const defaultConfig = (): AppConfig => ({
  clock: () => new Date(),
  operators: {},
  otpTtlMs: 5 * 60_000,
  otpMaxPerHour: 5,
  otpMaxPerHourPerDevice: 30,
  stepUpMs: 15 * 60_000,
  deliverOtp: () => {},
  contactRevealPerDay: 10,
  blobs: new MemoryBlobStore(),
  uploadSecret: "dev-upload-secret-change-me",
  baseUrl: "",
});

/** Composition root: every service, wired once. Services are stateless; all state lives in the store. */
export function createServices(cfg: AppConfig) {
  const audit = new AuditLog();
  const queue = new WorkQueue();
  const notifier = new Notifier(queue);
  const idempotency = new Idempotency();
  const reputation = new Reputation();
  const identity = new IdentityService(cfg, audit, queue, notifier);
  const participants = new Participants(identity, reputation);
  const prices = new PricesService(identity, audit, queue);
  const alerts = new AlertsService(prices, notifier);
  const lots = new LotsService(identity, participants, audit, queue, notifier);
  const deals = new DealsService(identity, lots, reputation, audit, queue, notifier);
  const requirements = new RequirementsService(identity, lots, participants);
  const offers = new OffersService(identity, lots, requirements, deals, audit, notifier, cfg.contactRevealPerDay);
  const operations = new OperationsService(identity, lots, audit, queue);
  const partners = new PartnersService(identity, deals, lots, audit, queue, notifier);
  const fpo = new FpoService(identity, lots, deals, audit);
  const media = new MediaService({ blobs: cfg.blobs, uploadSecret: cfg.uploadSecret, baseUrl: cfg.baseUrl }, identity, lots, deals);
  const maintenance = new MaintenanceService({ identity, prices, alerts, lots, requirements, offers, deals, media, idempotency, notifier });
  return { audit, queue, notifier, idempotency, reputation, identity, participants, prices, alerts, lots, deals, requirements, offers, operations, partners, fpo, media, maintenance };
}
export type Services = ReturnType<typeof createServices>;

export interface RunOptions {
  /** Lock rows read (default true); read-only requests pass false. */
  write?: boolean;
  cid?: string;
  /** Bearer token: the unit of work authenticates it first and runs as that user. */
  token?: string | undefined;
}

/** The application: services plus the store they run against. */
export class LiveCoco {
  readonly cfg: AppConfig;
  readonly store: Store;
  readonly services: Services;

  constructor(cfg: Partial<AppConfig> = {}, store: Store = new MemoryStore()) {
    this.cfg = { ...defaultConfig(), ...cfg };
    this.store = store;
    this.services = createServices(this.cfg);
  }

  /** Runs `fn` as one unit of work (see Store.run), optionally authenticated. */
  run<T>(fn: (s: Scope) => Promise<T>, opts: RunOptions = {}): Promise<T> {
    return this.store.run(async (tx) => {
      const s = new Scope(tx, this.cfg.clock, opts.cid ?? newCorrelationId());
      if ("token" in opts) s.actor = await this.services.identity.authenticate(s, opts.token);
      return fn(s);
    }, { write: opts.write ?? true });
  }
}
