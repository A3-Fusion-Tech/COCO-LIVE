import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller.ts";

@Module({ controllers: [IdentityController] })
export class IdentityModule {}
