# Capacity Assurance Platform

This directory contains the market-scale successor to the legacy single-file Capacity & Engineering Workbook.

The root `index.html` remains the reference implementation for proven domain behavior. It is not the architectural foundation of this platform.

## Product boundary

The platform answers:

> Can this plant or supplier meet committed demand, what constraint fails first, and what recovery action closes the gap credibly?

It is not an ERP, MRP, MES, finite scheduler, dispatching system, or accounting product.

## Architecture

- `packages/domain` — vendor-neutral canonical manufacturing-capacity model and runtime validation.
- `packages/engine` — deterministic, headless capacity and lead-time calculation engine.
- `packages/fixtures` — canonical synthetic regression and demonstration models.
- `packages/importer` — dependency-free CSV parsing, reusable demand mappings, row validation, and control totals.
- `apps/api` — runnable HTTP import, validation, and calculation service.
- `apps/web` — guided Assessment Studio for scope, demand import, readiness, calculation, and decision review.
- `database/migrations` — normalized PostgreSQL persistence contract.

## Modeling principles

1. Sparse routing assignments replace product-by-department matrices.
2. `notApplicable`, `missing`, `zero`, and numeric `value` are distinct states.
3. Products may have multiple effective-dated routing revisions.
4. Product operations map to product-specific lead-time phases.
5. Resources use working calendars with date exceptions, not annual capacity divided by twelve.
6. Labor, equipment, skills, tooling, space, external services, and other constraints share a common resource abstraction.
7. Source-system identifiers are aliases; no ERP vendor owns the core model.
8. The calculation engine is independent of UI, persistence, and integrations.
9. Published decisions must remain reproducible through source snapshots, mapping versions, scenario versions, engine versions, and input digests.
10. Imports report control totals and rejected rows; bad data never silently becomes zero.
11. The guided interface uses progressive disclosure: decision first, details on demand.

## Current vertical slice

The working slice includes:

- canonical organization, product, routing, resource, calendar, scenario, and demand entities;
- runtime schema validation;
- monthly or weekly periods;
- date-based calendar capacity;
- product-specific lead-time phase allocation;
- sparse routing load;
- setup/batch load support;
- governing-constraint identification;
- full Northstar v2 canonical fixture with four distinct routes and 48 monthly demand records;
- dependency-free CSV parser with quoted fields, escaped quotes, BOM, CRLF, and header validation;
- reusable demand column mappings with ID, name, or external-key product matching;
- ISO and U.S. date parsing, row-level errors, and reconciliation totals;
- atomic scenario demand replacement with explicit partial-import opt-in;
- runnable HTTP endpoints for health, fixture retrieval, validation, demand import preview/apply, and calculation;
- guided browser workflow: Scope → Data → Readiness → Analysis → Decision;
- executive decision summary and ranked constraint-period table;
- responsive desktop, tablet, and phone layout;
- normalized PostgreSQL migration for identity, tenancy, model entities, source lineage, mappings, calculations, results, and audit;
- automated engine, fixture, importer, API, HTTP integration, and web decision tests.

## Commands

```bash
corepack enable
cd platform
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm dev
```

`pnpm dev` starts the API on `127.0.0.1:3000` and the Assessment Studio on `127.0.0.1:4173`.

## API contract

- `GET /health`
- `GET /v1/fixtures/northstar-v2`
- `POST /v1/validate` with either a canonical model or `{ "model": ... }`
- `POST /v1/import/demand/preview` with `{ "model": ..., "scenarioId": "...", "csv": "...", "mapping": {...} }`
- `POST /v1/import/demand/apply` with the preview payload and optional `acceptPartial: true`
- `POST /v1/calculate` with `{ "model": ..., "scenarioId": "..." }`

All import and calculation input is runtime-validated before it changes a model or reaches the engine.

## Build gates

Before this branch is ready to merge:

- CI is green.
- Northstar synthetic case is represented in the canonical schema.
- Golden calculations reproduce the intended lead-time and routing behavior.
- Missing and not-applicable inputs cannot silently become zero.
- Demand import exposes accepted/rejected rows and control totals.
- The API validates every import and calculation request.
- The first guided workflow reaches a governing-constraint decision without direct API use.
- The database migration is reviewed before deployment.
- No changes are made to the legacy `index.html`.

## Next vertical slices

1. Baseline-versus-recovery scenario comparison with governed action effects.
2. Golden expected-result snapshots and deeper v6.86 reconciliation.
3. Product, routing, resource, and calendar table import mappings.
4. PostgreSQL repository implementation and migration CI.
5. Executive decision report export and portable assessment package.
