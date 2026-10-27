import { MARKETS, conflict, invalid, notFound, type MarketStage, type ProductId, type Unit } from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import type { Scope } from "../../core/scope.ts";
import type { Notifier } from "../../core/notifier.ts";
import type { PricesService } from "./prices.service.ts";

export interface AlertSubscription {
  alertId: string; userId: string; productId: ProductId; marketId: string; unit: Unit; stage: MarketStage; direction: "ABOVE" | "BELOW" | "BULLETIN";
  thresholdPaise: number | undefined; channel: "SMS" | "WHATSAPP" | "PUSH"; consentAt: string; status: "ACTIVE" | "PAUSED" | "CANCELLED"; lastTriggeredKey: string | undefined;
}
export interface AlertInput { productId: ProductId; marketId: string; unit: Unit; stage: MarketStage; direction: AlertSubscription["direction"]; thresholdPaise?: number; channel: AlertSubscription["channel"]; consent: boolean }

interface PriceItem { product: { productId: string }; market: { marketId: string }; stage: string; range: { perUnit: string; reference: { amountPaise: number } }; observedWindow: { endsAt: string }; freshness: string }

/** Price alerts with explicit channel consent; evaluation is idempotent so repeated ticks never spam. */
export class AlertsService {
  private readonly prices: PricesService;
  private readonly notifier: Notifier;

  constructor(prices: PricesService, notifier: Notifier) {
    this.prices = prices;
    this.notifier = notifier;
  }

  create(s: Scope, input: AlertInput): AlertSubscription {
    if (!input.consent) throw invalid("CONSENT_REQUIRED", "Consent to receive alerts is required");
    if (input.direction !== "BULLETIN" && !input.thresholdPaise) throw invalid("THRESHOLD_REQUIRED", "Threshold required");
    const a: AlertSubscription = { alertId: uid("alert"), userId: s.user.userId, productId: input.productId, marketId: input.marketId, unit: input.unit, stage: input.stage, direction: input.direction, thresholdPaise: input.thresholdPaise, channel: input.channel, consentAt: s.iso(), status: "ACTIVE", lastTriggeredKey: undefined };
    return s.tx.put(C.alerts, a.alertId, a);
  }

  mine(s: Scope) { return s.tx.find<AlertSubscription>(C.alerts, { userId: s.user.userId }); }

  async setStatus(s: Scope, alertId: string, status: AlertSubscription["status"]) {
    const a = await s.tx.get<AlertSubscription>(C.alerts, alertId);
    if (!a || a.userId !== s.user.userId) throw notFound("Alert");
    if (a.status === "CANCELLED") throw conflict("ALERT_CANCELLED", "Alert is cancelled");
    return s.tx.put(C.alerts, alertId, { ...a, status });
  }

  /** A threshold alert fires once per crossing and re-arms when the price leaves the zone; bulletins fire once per day. */
  async evaluate(s: Scope): Promise<number> {
    const prices = (await this.prices.latestPrices(s)) as unknown as PriceItem[];
    let sent = 0;
    for (const a of await s.tx.find<AlertSubscription>(C.alerts, { status: "ACTIVE" })) {
      const price = prices.find((p) => p.product.productId === a.productId && (p.market.marketId === a.marketId || MARKETS[p.market.marketId]?.areaId === a.marketId) && p.range.perUnit === a.unit && p.stage === a.stage);
      if (!price || price.freshness === "STALE") continue;
      const ref = price.range.reference.amountPaise;
      const hit = a.direction === "BULLETIN" || (a.direction === "ABOVE" ? ref >= (a.thresholdPaise as number) : ref <= (a.thresholdPaise as number));
      if (!hit) {
        if (a.lastTriggeredKey !== undefined) s.tx.put(C.alerts, a.alertId, { ...a, lastTriggeredKey: undefined });
        continue;
      }
      const key = a.direction === "BULLETIN" ? `bulletin:${a.alertId}:${price.observedWindow.endsAt.slice(0, 10)}` : `threshold:${a.alertId}`;
      if (a.lastTriggeredKey === key) continue;
      const data = { alertId: a.alertId, referencePaise: ref, observedAt: price.observedWindow.endsAt, link: `/prices/${a.productId}/${a.marketId}` };
      if (await this.notifier.notify(s, a.userId, a.channel, "price.alert", data, `${key}:${price.observedWindow.endsAt}`)) {
        sent++;
        s.tx.put(C.alerts, a.alertId, { ...a, lastTriggeredKey: key });
      }
    }
    return sent;
  }
}
