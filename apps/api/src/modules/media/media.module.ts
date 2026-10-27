import { Module } from "@nestjs/common";
import { MediaController } from "./media.controller.ts";

@Module({ controllers: [MediaController] })
export class MediaModule {}
