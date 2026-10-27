import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller.ts";

@Module({ controllers: [OperationsController] })
export class OperationsModule {}
