import { Module } from "@nestjs/common";
import { DealsController } from "./deals.controller.ts";

@Module({ controllers: [DealsController] })
export class DealsModule {}
