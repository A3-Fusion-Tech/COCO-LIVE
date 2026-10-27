import { Controller, Get, Inject, Put, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "@livecoco/domain";
import { API_OPTIONS, type ApiOptions } from "../options.ts";
import { Binary } from "../route-kit.ts";

/** Binary endpoints outside the JSON pipeline: signed direct upload and authorised media download. */
@Controller("v1")
export class MediaController {
  private readonly opts: ApiOptions;
  constructor(@Inject(API_OPTIONS) opts: ApiOptions) { this.opts = opts; }

  @Put("uploads/:mediaId")
  @Binary()
  async upload(@Req() req: IncomingMessage & { params: Record<string, string>; query: Record<string, string> }, @Res() res: ServerResponse) {
    const { platform: p, store } = this.opts;
    const mediaId = req.params.mediaId as string;
    if (!/^media_[0-9a-f]{16}$/.test(mediaId)) throw new DomainError("NOT_FOUND", 404, "No such endpoint", "error.not_found");
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) { size += c.length; if (size > 12_000_000) throw new DomainError("PAYLOAD_TOO_LARGE", 413, "Payload too large"); chunks.push(c); }
    const bytes = Buffer.concat(chunks);
    const receive = () => p.fx.receiveUpload(mediaId, Number(req.query.exp), String(req.query.sig ?? ""), bytes);
    const m = await (store ? store.withTransaction(p, receive) : receive());
    res.writeHead(200, { "content-type": "application/json", "x-correlation-id": String(res.getHeader("x-correlation-id") ?? ""), "x-content-type-options": "nosniff", "cache-control": "no-store" });
    res.end(JSON.stringify({ mediaId: m.mediaId, status: m.status }));
  }

  @Get("media/:mediaId")
  @Binary()
  async download(@Req() req: IncomingMessage & { params: Record<string, string> }, @Res() res: ServerResponse) {
    const { platform: p, store } = this.opts;
    const mediaId = req.params.mediaId as string;
    if (!/^media_[0-9a-f]{16}$/.test(mediaId)) throw new DomainError("NOT_FOUND", 404, "No such endpoint", "error.not_found");
    const auth = req.headers.authorization;
    const read = async () => { const { user } = p.authenticate(auth?.startsWith("Bearer ") ? auth.slice(7) : undefined); return p.fx.readMedia(user, mediaId); };
    const got = await (store ? store.withTransaction(p, read, { readOnly: true }) : read());
    res.writeHead(200, { "content-type": got.media.contentType, "content-length": got.bytes.length, "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": "private, no-store", "x-correlation-id": String(res.getHeader("x-correlation-id") ?? "") });
    res.end(Buffer.from(got.bytes));
  }
}
