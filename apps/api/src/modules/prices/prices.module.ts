import { Module } from "@nestjs/common";
import { PricesController } from "./prices.controller.ts";

@Module({ controllers: [PricesController] })
export class PricesModule {}
