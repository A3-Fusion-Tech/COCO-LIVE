import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { is, type Shape as ShapeSpec } from "@livecoco/contracts";
import type { Locale } from "@livecoco/localization";
import type { Scope } from "../core/scope.ts";

/** Everything a route handler needs, assembled by the request pipeline inside the request's unit of work. */
export interface Ctx {
  /** The unit of work; `s.user` / `s.session` are set for authenticated routes. */
  s: Scope;
  ip: string;
  body: Record<string, any>;
  params: Record<string, string>;
  query: URLSearchParams;
  locale: Locale;
  ifMatch: number | undefined;
}

export const ROUTE_META = { public: "lc:public", idempotent: "lc:idempotent", shape: "lc:shape", binary: "lc:binary" } as const;

/** No session required. */
export const Public = () => SetMetadata(ROUTE_META.public, true);
/** Requires an `Idempotency-Key` header; a retry returns the original outcome. */
export const Idempotent = () => SetMetadata(ROUTE_META.idempotent, true);
/** Request body validation; failures return 422 VALIDATION_FAILED with field errors. */
export const Shape = (shape: ShapeSpec) => SetMetadata(ROUTE_META.shape, shape);
/** Streams its own request/response (uploads, media); skips the JSON pipeline. */
export const Binary = () => SetMetadata(ROUTE_META.binary, true);

/** Injects the request context built by the pipeline. */
export const C = createParamDecorator((_data: unknown, ctx: ExecutionContext): Ctx => ctx.switchToHttp().getRequest().lcCtx);

export const created = (body: unknown) => ({ status: 201, body });
export const raw = (status: number, text: string, contentType: string) => ({ status, raw: text, contentType });
export const items = async <T>(p: Promise<T[]> | T[]) => ({ items: await p });
export const ok = async (p: Promise<unknown> | unknown) => { await p; return { ok: true }; };

export const money = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
export const termsShape: ShapeSpec = { terms: is.object, expiresAt: is.iso };
export const alertShape: ShapeSpec = { productId: is.string, marketId: is.string, unit: is.string, stage: is.string, direction: is.oneOf("ABOVE", "BELOW", "BULLETIN"), channel: is.oneOf("SMS", "WHATSAPP", "PUSH"), consent: is.bool };
export const reqShape: ShapeSpec = { productId: is.string, gradeGroup: is.string, unit: is.string, targetQuantity: is.string, destinationMarketId: is.string, maxRadiusKm: (v) => typeof v === "number" && v > 0, requiredFrom: is.iso, requiredBy: is.iso, expiresAt: is.iso };
