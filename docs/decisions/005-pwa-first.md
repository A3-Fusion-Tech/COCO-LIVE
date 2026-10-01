# ADR-005: PWA before native mobile

**Status:** Accepted  
**Date:** 2026-10-01

## Context

The MVP needs public indexable price pages, fast iteration and mobile workflows. Maintaining separate native clients would slow validation.

## Decision

Build a responsive server-rendered web application with installable PWA behavior. Consider a thin Android wrapper or native client after measured requirements emerge.

## Consequences

- One primary UI codebase and linkable public pages.
- Some background/device integration may be weaker than native.
- Offline drafts and notification support require careful browser-capability fallbacks.

## Review triggers

- Play Store distribution is essential for acquisition.
- Required notification/device behavior is unreliable on target devices.
- Field workflows need native camera/location/background features.

