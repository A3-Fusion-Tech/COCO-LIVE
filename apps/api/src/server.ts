import "reflect-metadata";
import type { Server } from "node:http";
import { Global, Module, type DynamicModule, type Provider } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { createLogger, Metrics } from "@livecoco/observability";
import type { Services } from "./app.ts";
import { API_OPTIONS, type ApiOptions } from "./http/options.ts";
import { LiveCocoAdapter, RequestInterceptor, preRouting, ProblemFilter } from "./http/pipeline.ts";
import { DealsModule } from "./modules/deals/deals.module.ts";
import { FulfilmentModule } from "./modules/fulfilment/fulfilment.module.ts";
import { IdentityModule } from "./modules/identity/identity.module.ts";
import { MarketplaceModule } from "./modules/marketplace/marketplace.module.ts";
import { MediaModule } from "./modules/media/media.module.ts";
import { OperationsModule } from "./modules/operations/operations.module.ts";
import { PricesModule } from "./modules/prices/prices.module.ts";

export type { ApiOptions } from "./http/options.ts";

export const FEATURE_MODULES = [IdentityModule, PricesModule, MarketplaceModule, DealsModule, FulfilmentModule, MediaModule, OperationsModule];

/** Every service instance from the composition root, registered under its own class as the Nest token. */
const serviceProviders = (services: Services): Provider[] =>
  Object.values(services).map((instance) => ({ provide: (instance as object).constructor, useValue: instance }));

/** Global module: API options and all services, available to every feature module's controllers. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(opts: ApiOptions): DynamicModule {
    const providers = [{ provide: API_OPTIONS, useValue: opts }, ...serviceProviders(opts.app.services)];
    return { module: CoreModule, providers, exports: providers };
  }
}

@Module({})
export class AppModule {
  static forRoot(opts: ApiOptions): DynamicModule {
    return { module: AppModule, imports: [CoreModule.forRoot(opts), ...FEATURE_MODULES] };
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
  app.useGlobalInterceptors(new RequestInterceptor(opts, metrics));
  app.useGlobalFilters(new ProblemFilter(log, metrics));
  await app.init();
  return app.getHttpServer() as Server;
}
