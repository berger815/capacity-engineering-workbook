# PostgreSQL persistence

The numbered migrations define the connected-platform persistence contract:

- `migrations/0001_core.sql` establishes tenancy, canonical model data, imports, calculations, results, and audit.
- `migrations/0002_scenario_actions.sql` adds governed recovery actions, immutable calculation-action snapshots, and baseline-versus-recovery comparison records.

The schema deliberately separates:

- identity and tenant membership;
- organization hierarchy;
- calendars and date exceptions;
- products and effective-dated routing revisions;
- sparse operation/resource requirements;
- immutable scenarios and demand records;
- dated recovery actions with target, owner, status, confidence, and inclusion state;
- source snapshots, reusable mappings, and import jobs;
- calculation runs, applied-action lineage, period results, and scenario comparisons;
- append-only audit events.

The calculation engine remains database-independent. A repository layer will assemble a canonical `CapacityModel`, calculate it with `@capacity/engine`, and persist immutable run metadata, action snapshots, comparison summaries, and results.

## Migration verification

Platform CI starts a clean PostgreSQL 16 service, applies every migration in lexical order with `ON_ERROR_STOP=1`, verifies the recovery tables exist, and only then runs the application build, strict typecheck, and tests.

## Migration rule

Never edit an applied migration. Add a new numbered migration and test both clean installation and upgrade paths.

## Security rule

Every business entity is tenant-scoped. Application queries must always include the authenticated tenant. Database row-level security will be added before any multi-tenant deployment.
