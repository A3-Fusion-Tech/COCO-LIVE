import { Module } from "@nestjs/common";
import { FulfilmentController } from "./fulfilment.controller.ts";

@Module({ controllers: [FulfilmentController] })
export class FulfilmentModule {}
