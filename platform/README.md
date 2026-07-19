# Capacity Assurance Platform

This directory contains the market-scale successor to the legacy single-file Capacity & Engineering Workbook.

The root `index.html` remains the reference implementation for proven domain behavior. It is not the architectural foundation of this platform.

## Product boundary

The platform answers:

> Can this plant or supplier meet committed demand, what constraint fails first, why does it fail, and what recovery action closes the gap credibly?

It is not an ERP, MRP, MES, finite scheduler, dispatching system, or accounting product.

The platform may carry planning-level WIP, dwell, footprint occupancy, and action records needed to assess commitment credibility. It does not manage transactional inventory, costing, warehouse movements, production dispatch, or financial accounting. Planning WIP does not net demand unless a future, explicitly governed engine feature is specified and tested.

## Architecture

- `packages/domain` — vendor-neutral canonical manufacturing-capacity, scenario, comparison, explanation, footprint-planning, and assessment-governance contracts.
- `packages/engine` — deterministic baseline, recovery, lead-time, capacity, comparison, and load-explanation engine.
- `packages/fixtures` — canonical synthetic regression and demonstration models.
- `packages/importer` — dependency-free CSV parsing, reusable entity mappings, row validation, reconciliation totals, canonical exporters, and versioned source profiles.
- `packages/reporting` — portable assessment snapshots and standalone printable executive decision reports.
- `apps/api` — HTTP import, validation, calculation, comparison, explanation, and reporting service.
- `apps/web` — guided and expert Assessment Studio from scope through recovery, footprint, action tracking, explainability, and decision export.
- `database/migrations` — normalized PostgreSQL persistence contract, including recovery action and comparison lineage.

## Modeling principles

1. Sparse routing assignments replace product-by-department matrices.
2. `notApplicable`, `missing`, `zero`, and numeric `value` are distinct states.
3. Products may have multiple effective-dated routing revisions.
4. Product operations map to product-specific lead-time phases.
5. Resources use working calendars with date exceptions, not annual capacity divided by twelve.
6. Labor, equipment, skills, tooling, space, external services, and other constraints share a common resource abstraction.
7. Source-system identifiers are aliases; no ERP vendor owns the core model.
8. The calculation engine is independent of UI, persistence, and integrations.
9. Published decisions remain reproducible through source snapshots, mapping versions, scenario versions, action snapshots, engine versions, and input digests.
10. Imports report control totals and rejected rows; bad data never silently becomes zero.
11. The interface supports guided and expert workflows with the same underlying model and controls.
12. A recovery scenario never mutates its protected baseline.
13. Every explained period load must reconcile to its calculated load.
14. Planning WIP and dwell inform footprint occupancy first; they do not silently alter demand or production-load timing.

## Current vertical slice

The working slice includes:

- canonical organization, product, routing, resource, calendar, scenario, demand, recovery-action, comparison, explanation, action-log, planning-WIP, and footprint entities;
- runtime schema validation, target validation, scenario lineage checks, and action governance;
- monthly or weekly periods;
- date-based calendar capacity;
- product-specific lead-time phase allocation;
- sparse routing load;
- setup/batch load support;
- governing-constraint identification;
- full Northstar v2 canonical fixture with four distinct routes and 48 monthly demand records;
- governed Northstar recovery fixture with dated equipment, labor, and temporary capacity actions;
- baseline demand inheritance without copied or mutated demand records;
- baseline-versus-recovery comparison with load, capacity, gap, and utilization deltas;
- dependency-free CSV parser with quoted fields, escaped quotes, BOM, CRLF, and header validation;
- reusable mappings and importers for calendars, resource groups, resources, products, routings, and demand;
- CSV and browser-side Excel intake with worksheet selection, profiles, preview, reconciliation, and transactional apply;
- canonical inline editing for products, calendars, resource groups, resources, and routing structure;
- guided and expert interface modes persisted in the browser;
- planning-level footprint, WIP, dwell, space-per-unit, available-area, and peak-factor analysis without inventory netting;
- assessment Action Log for data gaps, assumptions, risks, decisions, and follow-up;
- HTTP endpoints for health, fixture retrieval, validation, imports, calculation, comparison, explanation, and reporting;
- named recovery actions with target, effective dates, owner, approval state, confidence, and audit-preserving rejection;
- explainable drill-through from a resource period to product, demand record, routing revision, operation, standard, setup, and lead-time allocation;
- explicit explained-versus-calculated load reconciliation;
- downloadable standalone HTML executive report;
- downloadable portable JSON assessment containing the complete model, comparison, action lineage, assumptions, planning context, and results;
- responsive desktop, tablet, and phone layout;
- PostgreSQL migrations for identity, tenancy, model entities, source lineage, imports, calculations, recovery actions, action snapshots, scenario comparisons, results, and audit;
- CI execution of every migration against a clean PostgreSQL 16 service;
- automated domain, engine, fixture, importer, API, reporting, explanation, HTTP integration, and web tests.

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
- `POST /v1/import/{entity}/preview` for calendars, resource groups, resources, products, routing, and demand
- `POST /v1/import/{entity}/apply` with the preview payload and optional `acceptPartial: true`
- `POST /v1/calculate` with `{ "model": ..., "scenarioId": "..." }`
- `POST /v1/compare` with `{ "model": ..., "baselineScenarioId": "...", "comparisonScenarioId": "..." }`
- `POST /v1/explain` with `{ "model": ..., "scenarioId": "...", "resourceGroupId": "...", "periodStart": "YYYY-MM-DD" }`
- `POST /v1/report/decision` with the comparison payload and `format: "html" | "json"`

All import, calculation, comparison, explanation, and report input is runtime-validated before it changes a model or reaches the engine.

## Build gates

Before a branch is ready to merge:

- CI is green.
- All PostgreSQL migrations execute against a clean database.
- Northstar synthetic baseline and recovery cases are represented in the canonical schema.
- Golden calculations reproduce the intended lead-time, routing, recovery, and explanation behavior.
- Missing and not-applicable inputs cannot silently become zero.
- Imports expose accepted/rejected rows and control totals.
- The API validates every import, calculation, comparison, explanation, and report request.
- The browser workflow reaches a baseline-versus-recovery decision without direct API use.
- Constraint detail reconciles to the selected calculated period.
- The decision can be exported as both an executive report and a portable assessment snapshot.
- No changes are made to the legacy `index.html`.

## Remaining R0 work

1. Deeper golden-result reconciliation against v6.86 expected values.
2. PostgreSQL repository implementation for saved assessments and immutable runs.
3. Authentication, tenant enforcement, and deployment configuration.
4. Performance benchmark at the R0 market-entry scale.
5. Distinctive product branding after workflow and layout stabilization.
