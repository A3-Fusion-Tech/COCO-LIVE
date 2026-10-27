import type { IncomingMessage, ServerResponse } from "node:http";
import { Catch, NotFoundException, type ArgumentsHost, type CallHandler, type ExceptionFilter, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { from, lastValueFrom, type Observable } from "rxjs";
import { DomainError } from "@livecoco/domain";
import { check, problem, type FieldError, type Shape } from "@livecoco/contracts";
import { newCorrelationId, type Logger, type Metrics } from "@livecoco/observability";
import { parseLocale, t, type Locale } from "@livecoco/localization";
import type { ApiOptions } from "./options.ts";
import { ROUTE_META, type Ctx } from "./route-kit.ts";

/** Per-request state set before routing. */
interface LcRequest extends IncomingMessage { lc: { cid: string; locale: Locale; ip: string; url: URL }; lcCtx?: Ctx; params: Record<string, string> }

/** A fully-formed HTTP response produced by the pipeline and written verbatim by the adapter. */
interface Envelope { __lc: true; status: number; body?: unknown; raw?: string; headers: Record<string, string> }
const isEnvelope = (v: unknown): v is Envelope => !!v && typeof v === "object" && (v as Envelope).__lc === true;

function writeJson(res: ServerResponse, status: number, body: unknown, cid: string, extra: Record<string, string> = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": status >= 400 ? "application/problem+json" : "application/json", "x-correlation-id": cid, "x-content-type-options": "nosniff", "cache-control": status === 200 && extra["x-public"] ? "public, max-age=60" : "no-store", ...extra });
  res.end(data);
}

function writeProblem(res: ServerResponse, req: LcRequest, status: number, code: string, title: string, detail: string, fieldErrors: FieldError[] = [], messageKey?: string) {
  const pr = problem(status, code, title, detail, req.lc.cid, fieldErrors, messageKey);
  writeJson(res, status, { ...pr, message: t(req.lc.locale, pr.messageKey) }, req.lc.cid);
}

/** Express adapter that writes pipeline envelopes exactly (status, headers, no charset rewriting or ETags). */
export class LiveCocoAdapter extends ExpressAdapter {
  override reply(response: ServerResponse, body: unknown, statusCode?: number) {
    if (!isEnvelope(body)) return super.reply(response, body, statusCode);
    const cid = String(response.getHeader("x-correlation-id") ?? "");
    if (body.raw !== undefined) {
      response.writeHead(body.status, { "x-correlation-id": cid, "x-content-type-options": "nosniff", "cache-control": "no-store", "content-disposition": "attachment", ...body.headers });
      return void response.end(body.raw);
    }
    writeJson(response, body.status, body.body, cid, body.headers);
  }
}

/** Runs before routing: correlation id, locale, client IP, health probes and the per-IP rate limit. */
export function preRouting(opts: ApiOptions, metrics: Metrics) {
  const clock = opts.app.cfg.clock;
  const buckets = new Map<string, { n: number; reset: number }>();
  const limit = opts.requestsPerMinute ?? 300;
  return (req: LcRequest, res: ServerResponse, next: () => void) => {
    const cid = (req.headers["x-correlation-id"] as string | undefined)?.slice(0, 64) || newCorrelationId();
    res.setHeader("x-correlation-id", cid);
    const url = new URL(req.url ?? "/", "http://x");
    const ip = (opts.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() : "") || req.socket.remoteAddress || "?";
    req.lc = { cid, locale: parseLocale(req.headers["accept-language"] as string | undefined, url.searchParams.get("lang")), ip, url };
    if (url.pathname === "/healthz") return writeJson(res, 200, { status: "ok" }, cid);
    if (url.pathname === "/readyz") return writeJson(res, 200, { status: "ready", metrics: metrics.snapshot() }, cid);
    const now = clock().getTime();
    const b = buckets.get(ip);
    if (!b || b.reset < now) buckets.set(ip, { n: 1, reset: now + 60_000 });
    else if (++b.n > limit) { res.setHeader("retry-after", "30"); return writeProblem(res, req, 429, "RATE_LIMITED", "Too many requests", "Retry later", [], "error.rate_limited"); }
    next();
  };
}

function readBody(req: IncomingMessage, maxBody: number) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > maxBody) { reject(new DomainError("PAYLOAD_TOO_LARGE", 413, "Payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new DomainError("MALFORMED_JSON", 400, "Malformed JSON")); } });
    req.on("error", reject);
  });
}

/** Thrown for request-shape failures so the filter can render field errors. */
class ValidationFailed extends Error {
  readonly fieldErrors: FieldError[];
  constructor(fieldErrors: FieldError[]) { super("Validation failed"); this.fieldErrors = fieldErrors; }
}
class BodyNotObject extends Error {}

/**
 * The request pipeline for every JSON route: body parsing and validation, then one unit of work (ADR-010)
 * covering session authentication, idempotency and the controller method itself. GET requests run without
 * row locks; everything else locks the rows it reads.
 */
export class RequestInterceptor implements NestInterceptor {
  private readonly opts: ApiOptions;
  private readonly metrics: Metrics;
  private readonly reflector = new Reflector();
  constructor(opts: ApiOptions, metrics: Metrics) { this.opts = opts; this.metrics = metrics; }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.get<boolean>(ROUTE_META.binary, context.getHandler())) return next.handle();
    return from(this.run(context, next));
  }

  private async run(context: ExecutionContext, next: CallHandler): Promise<Envelope> {
    const { app } = this.opts;
    const handler = context.getHandler();
    const meta = <T>(key: string) => this.reflector.get<T>(key, handler);
    const auth = !(meta<boolean>(ROUTE_META.public) ?? false);
    const idem = meta<boolean>(ROUTE_META.idempotent) ?? false;
    const shape = meta<Shape>(ROUTE_META.shape);
    const req = context.switchToHttp().getRequest<LcRequest>();
    const { cid, locale, ip, url } = req.lc;

    const raw = req.method === "GET" ? {} : await readBody(req, this.opts.maxBodyBytes ?? 256 * 1024);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new BodyNotObject();
    const body = raw as Record<string, any>;
    if (shape) {
      const errs = check(body, shape);
      if (errs.length) throw new ValidationFailed(errs);
    }
    const h = req.headers.authorization;
    const ifMatchHeader = req.headers["if-match"];
    const out = await app.run(async (s) => {
      req.lcCtx = { s, ip, body, params: { ...req.params }, query: url.searchParams, locale, ifMatch: ifMatchHeader ? Number(String(ifMatchHeader).replace(/"/g, "")) : undefined };
      const handle = () => lastValueFrom(next.handle());
      if (!idem) return handle();
      return app.services.idempotency.run(s, s.actor?.user.userId ?? ip, `${req.method} ${url.pathname}`, req.headers["idempotency-key"] as string | undefined, body, handle);
    }, { cid, write: req.method !== "GET", ...(auth ? { token: h?.startsWith("Bearer ") ? h.slice(7) : undefined } : {}) });
    this.metrics.inc(`http.${req.method}.ok`);
    if (out && typeof out === "object" && "raw" in out) { const r = out as { status: number; raw: string; contentType: string }; return { __lc: true, status: r.status, raw: r.raw, headers: { "content-type": r.contentType } }; }
    if (out && typeof out === "object" && "status" in out && "body" in out) return { __lc: true, status: (out as { status: number }).status, body: (out as { body: unknown }).body, headers: {} };
    return { __lc: true, status: 200, body: out, headers: auth ? {} : { "x-public": "1" } };
  }
}

/** Renders every failure in the problem format; internal errors never leak details. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log: Logger;
  private readonly metrics: Metrics;
  constructor(log: Logger, metrics: Metrics) { this.log = log; this.metrics = metrics; }

  catch(e: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<LcRequest>();
    const res = host.switchToHttp().getResponse<ServerResponse>();
    if (res.headersSent) return void res.end();
    if (e instanceof ValidationFailed) return writeProblem(res, req, 422, "VALIDATION_FAILED", "Validation failed", "Some fields are invalid", e.fieldErrors, "error.validation_failed");
    if (e instanceof BodyNotObject) return writeProblem(res, req, 400, "MALFORMED_JSON", "Malformed request", "Body must be a JSON object");
    if (e instanceof NotFoundException) return writeProblem(res, req, 404, "NOT_FOUND", "Not found", "No such endpoint", [], "error.not_found");
    if (e instanceof DomainError) {
      this.metrics.inc(`http.error.${e.code}`);
      if (e.status === 429) res.setHeader("retry-after", "60");
      return writeProblem(res, req, e.status, e.code, e.message, e.message, [], e.messageKey);
    }
    this.log.error("unhandled", { cid: req.lc?.cid, err: e instanceof Error ? e.name : "unknown" }); // no stack/SQL to clients
    this.metrics.inc("http.error.internal");
    return writeProblem(res, req, 503, "UNAVAILABLE", "Temporarily unavailable", "Try again later");
  }
}
