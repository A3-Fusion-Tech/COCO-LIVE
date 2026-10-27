import { Controller, Get, Patch, Post } from "@nestjs/common";
import { is } from "@livecoco/contracts";
import { C, Idempotent, Shape, alertShape, created, type Ctx } from "../route-kit.ts";

/** Price alerts with explicit channel consent. */
@Controller("v1")
export class AlertsController {
  @Post("alerts")
  @Shape(alertShape)
  @Idempotent()
  postAlerts(@C() { p, user, body }: Ctx) {
    return created(p.createAlert(user, body as never));
  }

  @Get("alerts")
  getAlerts(@C() { p, user }: Ctx) {
    return ({ items: [...p.alerts.values()].filter((a) => a.userId === user.userId) });
  }

  @Patch("alerts/:id")
  @Shape({ status: is.oneOf("ACTIVE", "PAUSED", "CANCELLED") })
  patchAlertsById(@C() { p, user, params, body }: Ctx) {
    return p.setAlertStatus(user, params.id as string, body.status);
  }
}
