import { Module } from "@nestjs/common";
import { MarketplaceController } from "./marketplace.controller.ts";

@Module({ controllers: [MarketplaceController] })
export class MarketplaceModule {}
