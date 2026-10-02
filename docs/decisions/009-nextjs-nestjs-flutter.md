# ADR-009: Next.js web, NestJS API and Flutter mobile

**Status:** Accepted  
**Date:** 2026-10-02  
**Supersedes:** [ADR-005](./005-pwa-first.md)

## Context

The first implementation used plain TypeScript on Node 22 with a hand-written route table and a vanilla-JS PWA, to keep dependencies near zero while the domain was being proven. The product owner has now fixed the stack: Next.js for the web, NestJS for the backend and Flutter for mobile. Farmers and traders in the Pollachi belt mostly use Android phones, and a Play Store app is the expected way to reach them.

## Decision

- **API:** NestJS 11 on the Express adapter. Each former route-table section is a controller in `apps/api/src/http/controllers`. A global interceptor keeps the existing request pipeline (body validation, the ADR-008 unit of work, service token, session, idempotency) and a global filter keeps the problem-response format, so every HTTP contract is unchanged. Decorators run through `tsx` (`node --import tsx`); there is no build step and no `emitDecoratorMetadata`, so providers are injected with explicit tokens.
- **Web:** Next.js replaces the vanilla PWA in `apps/web`, keeping server-rendered public price pages and the same-origin gateway that holds the session in an HttpOnly cookie.
- **Mobile:** a Flutter app in `apps/mobile` for Android first, talking to the same `/v1` API with Tamil and English.
- The domain packages, PostgreSQL persistence, worker and ADR-006 (no platform-held payments) are unaffected.

## Consequences

- The API now has framework dependencies (`@nestjs/*`, `express`, `reflect-metadata`, `rxjs`) and runs with `tsx`; `npm run dev`, tests and the e2e run use `node --import tsx`.
- `docs/api/endpoints.md` is generated from the controllers' route metadata.
- Mobile clients authenticate with bearer tokens directly, so token storage on the device must use the platform keystore.
- Two UI codebases (Next.js, Flutter) must keep Tamil/English catalogs in step.

## Alternatives considered

- Keep the dependency-free server and PWA (ADR-005): rejected by the product owner.
- React Native for mobile: rejected in favour of Flutter.

## Review triggers

- Request pipeline overhead in the interceptor becomes measurable.
- The web and mobile clients need a shared API client generated from an OpenAPI description.
