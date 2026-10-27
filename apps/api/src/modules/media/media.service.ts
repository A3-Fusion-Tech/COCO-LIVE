import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainError, conflict, invalid, notFound, type SellLot } from "@livecoco/domain";
import { C } from "../../core/collections.ts";
import { uid } from "../../core/ids.ts";
import { orNotFound, type Scope } from "../../core/scope.ts";
import type { IdentityService } from "../identity/identity.service.ts";
import type { DealsService } from "../deals/deals.service.ts";
import type { LotsService } from "../marketplace/lots.service.ts";

export type MediaStatus = "PENDING_UPLOAD" | "UPLOADED" | "APPROVED" | "REJECTED";
export interface Media { mediaId: string; ownerId: string; purpose: "LOT_PHOTO" | "DEAL_EVIDENCE" | "VERIFICATION_DOCUMENT"; refId: string | undefined; contentType: string; declaredBytes: number; actualBytes: number | undefined; status: MediaStatus; rejectionReason: string | undefined; sha256: string | undefined; createdAt: string; expiresAt: string }

/** Object storage seam: local filesystem in development, S3-compatible in production. */
export interface BlobStore { put(key: string, bytes: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array | undefined>; delete(key: string): Promise<void> }

export class MemoryBlobStore implements BlobStore {
  private readonly m = new Map<string, Uint8Array>();
  async put(k: string, b: Uint8Array) { this.m.set(k, b); }
  async get(k: string) { return this.m.get(k); }
  async delete(k: string) { this.m.delete(k); }
}

/** Local-disk object store for development/self-hosting; keys are validated so paths cannot escape the root. */
export class FsBlobStore implements BlobStore {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  private path(key: string) {
    if (!/^private\/media_[0-9a-f]{16}$/.test(key)) throw new Error("invalid blob key");
    return join(this.root, key.replace("/", "-"));
  }
  async put(key: string, b: Uint8Array) { await mkdir(this.root, { recursive: true, mode: 0o700 }); await writeFile(this.path(key), b, { mode: 0o600 }); }
  async get(key: string) { try { return new Uint8Array(await readFile(this.path(key))); } catch { return undefined; } }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}

export const MEDIA_LIMITS: Record<string, { maxBytes: number; magic: number[][] }> = {
  "image/jpeg": { maxBytes: 8_000_000, magic: [[0xff, 0xd8, 0xff]] },
  "image/png": { maxBytes: 8_000_000, magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  "image/webp": { maxBytes: 8_000_000, magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/pdf": { maxBytes: 12_000_000, magic: [[0x25, 0x50, 0x44, 0x46]] },
};

export interface MediaConfig { blobs: BlobStore; uploadSecret: string; baseUrl: string }

const blobKey = (mediaId: string) => `private/${mediaId}`;

/**
 * Uploads in three steps: (1) an authenticated intent returns a short-lived signed URL, (2) the client PUTs the
 * bytes directly, (3) the worker sniffs content before anything is attached to a lot or deal or served to others.
 */
export class MediaService {
  private readonly cfg: MediaConfig;
  private readonly identity: IdentityService;
  private readonly lots: LotsService;
  private readonly deals: DealsService;

  constructor(cfg: MediaConfig, identity: IdentityService, lots: LotsService, deals: DealsService) {
    this.cfg = cfg;
    this.identity = identity;
    this.lots = lots;
    this.deals = deals;
  }

  private sign(mediaId: string, exp: number) { return createHmac("sha256", this.cfg.uploadSecret).update(`${mediaId}.${exp}`).digest("base64url"); }
  private async media(s: Scope, id: string) { return orNotFound(await s.tx.get<Media>(C.media, id), "Media"); }
  private save(s: Scope, m: Media) { return s.tx.put(C.media, m.mediaId, m); }

  async createUploadIntent(s: Scope, input: { purpose: Media["purpose"]; contentType: string; sizeBytes: number; refId?: string }) {
    const lim = MEDIA_LIMITS[input.contentType];
    if (!lim) throw invalid("UNSUPPORTED_TYPE", "Allowed types: " + Object.keys(MEDIA_LIMITS).join(", "));
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > lim.maxBytes) throw invalid("SIZE_NOT_ALLOWED", `Size must be 1..${lim.maxBytes} bytes`);
    if (input.purpose === "LOT_PHOTO") {
      if (!input.refId) throw invalid("REF_REQUIRED", "refId (sellLotId) is required");
      await this.lots.own(s, input.refId);
      if (input.contentType === "application/pdf") throw invalid("UNSUPPORTED_TYPE", "Lot photos must be images");
    }
    if (input.purpose === "DEAL_EVIDENCE") {
      if (!input.refId) throw invalid("REF_REQUIRED", "refId (dealId) is required");
      await this.deals.asParty(s, input.refId);
    }
    const exp = s.ms() + 15 * 60_000;
    const m: Media = { mediaId: uid("media"), ownerId: s.user.userId, purpose: input.purpose, refId: input.refId, contentType: input.contentType, declaredBytes: input.sizeBytes, actualBytes: undefined, status: "PENDING_UPLOAD", rejectionReason: undefined, sha256: undefined, createdAt: s.iso(), expiresAt: new Date(exp).toISOString() };
    this.save(s, m);
    return { mediaId: m.mediaId, uploadUrl: `${this.cfg.baseUrl}/v1/uploads/${m.mediaId}?exp=${exp}&sig=${this.sign(m.mediaId, exp)}`, expiresAt: m.expiresAt, method: "PUT" as const };
  }

  /** Direct upload with the short-lived signature (no session). */
  async receiveUpload(s: Scope, mediaId: string, exp: number, sig: string, bytes: Uint8Array): Promise<Media> {
    const want = Buffer.from(this.sign(mediaId, exp));
    const given = Buffer.from(sig);
    if (given.length !== want.length || !timingSafeEqual(given, want) || exp < s.ms()) throw new DomainError("UPLOAD_FORBIDDEN", 403, "Upload link is invalid or expired");
    const m = await this.media(s, mediaId);
    if (m.status !== "PENDING_UPLOAD") throw conflict("ALREADY_UPLOADED", "This upload slot was already used");
    if (bytes.length === 0 || bytes.length > m.declaredBytes) throw invalid("SIZE_MISMATCH", "Uploaded size does not match the declared size");
    await this.cfg.blobs.put(blobKey(mediaId), bytes);
    return this.save(s, { ...m, actualBytes: bytes.length, status: "UPLOADED" });
  }

  /** Content sniffing, signature and active-content checks; approved media is then attached to its lot or deal. */
  async scan(s: Scope, mediaId: string): Promise<Media> {
    const m = await this.media(s, mediaId);
    if (m.status !== "UPLOADED") return m;
    const bytes = await this.cfg.blobs.get(blobKey(mediaId));
    const lim = MEDIA_LIMITS[m.contentType] as (typeof MEDIA_LIMITS)[string];
    const reject = async (reason: string) => { await this.cfg.blobs.delete(blobKey(mediaId)); return this.save(s, { ...m, status: "REJECTED", rejectionReason: reason }); };
    if (!bytes) return reject("MISSING_OBJECT");
    if (!lim.magic.some((sig) => sig.every((b, i) => bytes[i] === b))) return reject("CONTENT_TYPE_MISMATCH");
    if (m.contentType === "image/webp" && Buffer.from(bytes.slice(8, 12)).toString("ascii") !== "WEBP") return reject("CONTENT_TYPE_MISMATCH");
    const head = Buffer.from(bytes.slice(0, Math.min(bytes.length, 65536))).toString("latin1");
    if (m.contentType === "application/pdf" && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(head + Buffer.from(bytes.slice(-4096)).toString("latin1"))) return reject("ACTIVE_CONTENT");
    if (/<\s*script|<\?php|MZ\x90\x00/i.test(head)) return reject("ACTIVE_CONTENT");
    const approved = this.save(s, { ...m, status: "APPROVED", sha256: createHash("sha256").update(bytes).digest("hex") });
    if (m.purpose === "LOT_PHOTO" && m.refId) {
      const lot = await s.tx.get<SellLot>(C.lots, m.refId);
      if (lot) { lot.photoCount++; this.lots.touch(s, lot); }
    }
    if (m.purpose === "DEAL_EVIDENCE" && m.refId) {
      const d = await this.deals.find(s, m.refId);
      if (d) this.identity.addEvidence(s, { ownerId: m.ownerId, dealId: d.dealId, kind: "MEDIA", visibleTo: [d.sellerId, d.buyerId], note: m.mediaId, sensitive: false });
    }
    return approved;
  }

  async scanPending(s: Scope): Promise<number> {
    const pending = await s.tx.find<Media>(C.media, { status: "UPLOADED" });
    for (const m of pending) await this.scan(s, m.mediaId);
    return pending.length;
  }

  /** Unscanned or rejected files are never served to others; verification documents only to their owner. */
  async read(s: Scope, mediaId: string): Promise<{ media: Media; bytes: Uint8Array }> {
    const m = await this.media(s, mediaId);
    const owner = m.ownerId === s.user.userId;
    if (m.status !== "APPROVED" && !owner) throw notFound("Media");
    if (!owner) {
      let allowed = m.purpose === "LOT_PHOTO"; // approved lot photos are part of the public lot view
      if (m.purpose === "DEAL_EVIDENCE" && m.refId) { const d = await this.deals.find(s, m.refId); allowed = !!d && (d.sellerId === s.user.userId || d.buyerId === s.user.userId); }
      if (!allowed) throw notFound("Media");
    }
    const bytes = await this.cfg.blobs.get(blobKey(mediaId));
    if (!bytes) throw notFound("Media");
    return { media: m, bytes };
  }

  /** Retention: abandoned upload slots. */
  async purgeExpiredUploads(s: Scope): Promise<number> {
    let n = 0;
    for (const m of await s.tx.find<Media>(C.media, { status: "PENDING_UPLOAD" })) {
      if (Date.parse(m.expiresAt) < s.ms()) { s.tx.delete(C.media, m.mediaId); await this.cfg.blobs.delete(blobKey(m.mediaId)); n++; }
    }
    return n;
  }
}
