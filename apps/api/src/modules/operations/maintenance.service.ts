import type { Scope } from "../../core/scope.ts";
import type { Idempotency } from "../../core/idempotency.ts";
import type { Notifier } from "../../core/notifier.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { AlertsService } from "../prices/alerts.service.ts";
import type { PricesService } from "../prices/prices.service.ts";
import type { DealsService } from "../deals/deals.service.ts";
import type { LotsService } from "../marketplace/lots.service.ts";
import type { OffersService } from "../marketplace/offers.service.ts";
import type { RequirementsService } from "../marketplace/requirements.service.ts";
import type { MediaService } from "../media/media.service.ts";

/** Scheduled background work run by the worker. Every step is idempotent, so overlapping or repeated ticks are safe. */
export class MaintenanceService {
  private readonly deps: { identity: IdentityService; prices: PricesService; alerts: AlertsService; lots: LotsService; requirements: RequirementsService; offers: OffersService; deals: DealsService; media: MediaService; idempotency: Idempotency; notifier: Notifier };

  constructor(deps: MaintenanceService["deps"]) { this.deps = deps; }

  /** Time-based expiry and deemed acceptance. */
  async runExpiry(s: Scope) {
    const d = this.deps;
    return { lots: await d.lots.expire(s), requirements: await d.requirements.expire(s), offers: await d.offers.expire(s), deemedAcceptances: await d.deals.applyDeemedAcceptance(s) };
  }

  /** Expiry, price aggregation and alert evaluation. */
  async tick(s: Scope) {
    const expiry = await this.runExpiry(s);
    const aggregatesChanged = await this.deps.prices.refreshAggregates(s);
    const alertsSent = await this.deps.alerts.evaluate(s);
    return { ...expiry, aggregatesChanged, alertsSent };
  }

  /** Retention of security state, idempotency keys, delivered messages and abandoned uploads; scanning of new uploads. */
  async housekeeping(s: Scope) {
    const d = this.deps;
    const security = await d.identity.purgeStaleSecurityState(s);
    const idempotencyKeysPurged = await d.idempotency.purge(s);
    await d.notifier.purgeDelivered(s);
    return { ...security, idempotencyKeysPurged, mediaScanned: await d.media.scanPending(s), uploadsPurged: await d.media.purgeExpiredUploads(s) };
  }
}
