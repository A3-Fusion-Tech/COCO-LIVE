import "reflect-metadata";
import type { Server } from "node:http";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { createLogger, Metrics } from "@livecoco/observability";
import { API_OPTIONS, type ApiOptions } from "./http/options.ts";
import { LiveCocoAdapter, PlatformInterceptor, preRouting, ProblemFilter } from "./http/pipeline.ts";
import { AlertsController } from "./http/controllers/alerts.controller.ts";
import { BuyRequirementsController } from "./http/controllers/buy-requirements.controller.ts";
import { CatalogController } from "./http/controllers/catalog.controller.ts";
import { ContributorsController } from "./http/controllers/contributors.controller.ts";
import { DealsController } from "./http/controllers/deals.controller.ts";
import { FulfilmentController } from "./http/controllers/fulfilment.controller.ts";
import { IdentityController } from "./http/controllers/identity.controller.ts";
import { InternalController } from "./http/controllers/internal.controller.ts";
import { MediaController } from "./http/controllers/media.controller.ts";
import { OffersController } from "./http/controllers/offers.controller.ts";
import { OperationsController } from "./http/controllers/operations.controller.ts";
import { SellLotsController } from "./http/controllers/sell-lots.controller.ts";

export type { ApiOptions } from "./http/options.ts";
/** @deprecated Use ApiOptions. */
export type ServerOptions = ApiOptions;

export const CONTROLLERS = [MediaController, CatalogController, IdentityController, AlertsController, ContributorsController, SellLotsController, BuyRequirementsController, OffersController, DealsController, OperationsController, FulfilmentController, InternalController];

/** The API's single NestJS module; the platform and its store are supplied by the caller. */
@Module({})
export class AppModule {
  static forRoot(opts: ApiOptions): DynamicModule {
    return { module: AppModule, controllers: CONTROLLERS, providers: [{ provide: API_OPTIONS, useValue: opts }] };
  }
}

/** Builds the NestJS application and returns its (not yet listening) HTTP server. */
export async function createApp(opts: ApiOptions): Promise<Server> {
  const log = opts.logger ?? createLogger(() => {});
  const metrics = opts.metrics ?? new Metrics();
  const instance = express();
  instance.disable("x-powered-by");
  instance.disable("etag");
  const app = await NestFactory.create(AppModule.forRoot(opts), new LiveCocoAdapter(instance), { bodyParser: false, logger: false });
  app.use(preRouting(opts, metrics));
  app.useGlobalInterceptors(new PlatformInterceptor(opts, metrics));
  app.useGlobalFilters(new ProblemFilter(log, metrics));
  await app.init();
  return app.getHttpServer() as Server;
}
