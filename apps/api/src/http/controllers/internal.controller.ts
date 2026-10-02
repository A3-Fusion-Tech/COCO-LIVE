import { Controller, Post } from "@nestjs/common";
import { is } from "../../../../../packages/contracts/src/index.ts";
import { C, Internal, Shape, type Ctx } from "../route-kit.ts";

/** Worker-only endpoints (ingestion, outbox delivery, maintenance tick), authenticated by the service token. */
@Controller("v1")
export class InternalController {
  @Post("internal/ingest")
  @Internal()
  @Shape({ source: is.string, records: Array.isArray })
  postInternalIngest(@C() { p, body }: Ctx) {
    const r = p.ingestRaw(body.source, body.records);
    return { ...r, aggregatesChanged: p.refreshAggregates() };
  }

  @Post("internal/source-failure")
  @Internal()
  @Shape({ source: is.string, error: is.string })
  postInternalSourceFailure(@C() { p, body }: Ctx) {
    return (p.recordSourceFailure(body.source, body.error), { ok: true });
  }

  @Post("internal/outbox/claim")
  @Internal()
  postInternalOutboxClaim(@C() { p, body }: Ctx) {
    return ({ items: p.claimOutbox(Number(body.limit) || 20) });
  }

  @Post("internal/outbox/ack")
  @Internal()
  @Shape({ notificationId: is.string, ok: is.bool })
  postInternalOutboxAck(@C() { p, body }: Ctx) {
    return (p.ackOutbox(body.notificationId, body.ok, body.error ?? ""), { ok: true });
  }

  @Post("internal/tick")
  @Internal()
  async postInternalTick(@C() { p }: Ctx) {
    return ({ ...p.maintenanceTick(), ...p.purgeStaleSecurityState(), mediaScanned: await p.fx.scanPending(), uploadsPurged: await p.fx.purgeExpiredUploads() });
  }
}
