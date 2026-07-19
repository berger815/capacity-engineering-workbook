# PostgreSQL persistence

`migrations/0001_core.sql` is the initial connected-platform persistence contract.

It deliberately separates:

- identity and tenant membership;
- organization hierarchy;
- calendars and date exceptions;
- products and effective-dated routing revisions;
- sparse operation/resource requirements;
- immutable scenarios and demand records;
- source snapshots, reusable mappings, and import jobs;
- calculation runs and period results;
- append-only audit events.

The calculation engine remains database-independent. A repository layer will assemble a canonical `CapacityModel`, calculate it with `@capacity/engine`, and persist immutable run metadata and results.

## Migration rule

Never edit an applied migration. Add a new numbered migration and test both clean installation and upgrade paths.

## Security rule

Every business entity is tenant-scoped. Application queries must always include the authenticated tenant. Database row-level security will be added before any multi-tenant deployment.
