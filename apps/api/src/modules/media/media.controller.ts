import { Controller, Get, Inject, Post, Put, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "@livecoco/domain";
import { is } from "@livecoco/contracts";
import { API_OPTIONS, type ApiOptions } from "../../http/options.ts";
import { Binary, C, Idempotent, Shape, created, type Ctx } from "../../http/route-kit.ts";
import { MediaService } from "./media.service.ts";

const MEDIA_ID = /^media_[0-9a-f]{16}$/;
const noSuchEndpoint = () => new DomainError("NOT_FOUND", 404, "No such endpoint", "error.not_found");
type Req_ = IncomingMessage & { params: Record<string, string>; query: Record<string, string> };

/** Upload intents (JSON), plus the binary endpoints outside the JSON pipeline: signed direct upload and authorised download. */
@Controller("v1")
export class MediaController {
  private readonly opts: ApiOptions;
  private readonly media: MediaService;
  constructor(@Inject(API_OPTIONS) opts: ApiOptions, @Inject(MediaService) media: MediaService) {
    this.opts = opts;
    this.media = media;
  }

  @Post("uploads/intents")
  @Shape({ purpose: is.oneOf("LOT_PHOTO", "DEAL_EVIDENCE", "VERIFICATION_DOCUMENT"), contentType: is.string, sizeBytes: is.int })
  @Idempotent()
  async intent(@C() { s, body }: Ctx) {
    return created(await this.media.createUploadIntent(s, body as never));
  }

  @Put("uploads/:mediaId")
  @Binary()
  async upload(@Req() req: Req_, @Res() res: ServerResponse) {
    const mediaId = req.params.mediaId as string;
    if (!MEDIA_ID.test(mediaId)) throw noSuchEndpoint();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) { size += c.length; if (size > 12_000_000) throw new DomainError("PAYLOAD_TOO_LARGE", 413, "Payload too large"); chunks.push(c); }
    const bytes = Buffer.concat(chunks);
    const m = await this.opts.app.run((s) => this.media.receiveUpload(s, mediaId, Number(req.query.exp), String(req.query.sig ?? ""), bytes));
    res.writeHead(200, { "content-type": "application/json", "x-correlation-id": String(res.getHeader("x-correlation-id") ?? ""), "x-content-type-options": "nosniff", "cache-control": "no-store" });
    res.end(JSON.stringify({ mediaId: m.mediaId, status: m.status }));
  }

  @Get("media/:mediaId")
  @Binary()
  async download(@Req() req: Req_, @Res() res: ServerResponse) {
    const mediaId = req.params.mediaId as string;
    if (!MEDIA_ID.test(mediaId)) throw noSuchEndpoint();
    const auth = req.headers.authorization;
    const got = await this.opts.app.run((s) => this.media.read(s, mediaId), { write: false, token: auth?.startsWith("Bearer ") ? auth.slice(7) : undefined });
    res.writeHead(200, { "content-type": got.media.contentType, "content-length": got.bytes.length, "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": "private, no-store", "x-correlation-id": String(res.getHeader("x-correlation-id") ?? "") });
    res.end(Buffer.from(got.bytes));
  }
}
