BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  external_subject text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','analyst','reviewer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE organization_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES organization_nodes(id) ON DELETE RESTRICT,
  node_type text NOT NULL CHECK (node_type IN ('enterprise','businessUnit','site','area','workCenter')),
  name text NOT NULL,
  external_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_nodes_tenant_parent_idx ON organization_nodes(tenant_id, parent_id);

CREATE TABLE working_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_week_patterns (
  calendar_id uuid NOT NULL REFERENCES working_calendars(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  available_minutes integer NOT NULL CHECK (available_minutes >= 0),
  PRIMARY KEY (calendar_id, weekday)
);

CREATE TABLE calendar_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES working_calendars(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  available_minutes integer NOT NULL CHECK (available_minutes >= 0),
  reason text,
  UNIQUE (calendar_id, exception_date)
);

CREATE TABLE resource_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_node_id uuid NOT NULL REFERENCES organization_nodes(id) ON DELETE RESTRICT,
  calendar_id uuid NOT NULL REFERENCES working_calendars(id) ON DELETE RESTRICT,
  name text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('labor','equipment','skill','tooling','space','external','other')),
  capacity_unit text NOT NULL CHECK (capacity_unit IN ('hours','units','squareFeet','palletPositions','custom')),
  pooled boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  external_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_groups_tenant_org_idx ON resource_groups(tenant_id, organization_node_id);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_group_id uuid NOT NULL REFERENCES resource_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  rate_per_available_hour numeric(18,6) NOT NULL CHECK (rate_per_available_hour > 0),
  availability numeric(9,6) NOT NULL CHECK (availability BETWEEN 0 AND 1),
  performance numeric(9,6) NOT NULL CHECK (performance BETWEEN 0 AND 1),
  quality numeric(9,6) NOT NULL CHECK (quality BETWEEN 0 AND 1),
  effective_from date,
  effective_to date,
  external_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE INDEX resources_group_effectivity_idx ON resources(resource_group_id, effective_from, effective_to);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_node_id uuid NOT NULL REFERENCES organization_nodes(id) ON DELETE RESTRICT,
  product_code text,
  name text NOT NULL,
  family text,
  configuration text,
  tags text[] NOT NULL DEFAULT '{}',
  external_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_code)
);
CREATE INDEX products_tenant_family_idx ON products(tenant_id, family);

CREATE TABLE routing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  revision text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  source_system text,
  source_revision text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (product_id, revision, effective_from)
);
CREATE INDEX routing_revisions_product_effectivity_idx ON routing_revisions(product_id, effective_from, effective_to);

CREATE TABLE lead_time_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_revision_id uuid NOT NULL REFERENCES routing_revisions(id) ON DELETE CASCADE,
  phase_key text NOT NULL,
  name text NOT NULL,
  start_weeks_before_ship numeric(12,4) NOT NULL CHECK (start_weeks_before_ship >= 0),
  end_weeks_before_ship numeric(12,4) NOT NULL CHECK (end_weeks_before_ship >= 0),
  allocation text NOT NULL CHECK (allocation IN ('spread','shiftToStart','shiftToEnd','shiftToMidpoint')),
  CHECK (start_weeks_before_ship >= end_weeks_before_ship),
  UNIQUE (routing_revision_id, phase_key)
);

CREATE TABLE routing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_revision_id uuid NOT NULL REFERENCES routing_revisions(id) ON DELETE CASCADE,
  phase_id uuid NOT NULL REFERENCES lead_time_phases(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  name text NOT NULL,
  alternate_group text,
  minimum_batch_size numeric(18,6) CHECK (minimum_batch_size > 0),
  maximum_batch_size numeric(18,6) CHECK (maximum_batch_size > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routing_revision_id, operation_key),
  UNIQUE (routing_revision_id, sequence, operation_key)
);
CREATE INDEX routing_operations_revision_sequence_idx ON routing_operations(routing_revision_id, sequence);

CREATE TABLE routing_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES routing_operations(id) ON DELETE CASCADE,
  resource_group_id uuid NOT NULL REFERENCES resource_groups(id) ON DELETE RESTRICT,
  applicability_state text NOT NULL CHECK (applicability_state IN ('notApplicable','missing','zero','value')),
  requirement_value numeric(18,6),
  capacity_unit text NOT NULL CHECK (capacity_unit IN ('hours','units','squareFeet','palletPositions','custom')),
  setup_requirement_value numeric(18,6),
  setup_quantity numeric(18,6),
  batch_size numeric(18,6) CHECK (batch_size > 0),
  source text,
  confidence text CHECK (confidence IN ('high','medium','low','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (applicability_state = 'value' AND requirement_value IS NOT NULL AND requirement_value >= 0)
    OR (applicability_state <> 'value' AND (requirement_value IS NULL OR requirement_value = 0))
  ),
  UNIQUE (operation_id, resource_group_id)
);
CREATE INDEX routing_requirements_resource_group_idx ON routing_requirements(resource_group_id);

CREATE TABLE scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_scenario_id uuid REFERENCES scenarios(id) ON DELETE RESTRICT,
  scenario_key text NOT NULL,
  name text NOT NULL,
  scenario_kind text NOT NULL CHECK (scenario_kind IN ('baseline','recovery','sensitivity')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded','archived')),
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, scenario_key)
);

CREATE TABLE demand_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  ship_date date NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity >= 0),
  demand_class text CHECK (demand_class IN ('firm','forecast','upside','downside')),
  customer_or_program text,
  source_system text,
  source_record_id text,
  source_snapshot_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demand_records_scenario_product_date_idx ON demand_records(scenario_id, product_id, ship_date);

CREATE TABLE source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  object_type text NOT NULL,
  content_sha256 text NOT NULL,
  storage_uri text,
  row_count bigint,
  captured_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, content_sha256)
);
ALTER TABLE demand_records
  ADD CONSTRAINT demand_records_source_snapshot_fk
  FOREIGN KEY (source_snapshot_id) REFERENCES source_snapshots(id) ON DELETE SET NULL;

CREATE TABLE source_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_system text NOT NULL,
  object_type text NOT NULL,
  mapping_version integer NOT NULL DEFAULT 1 CHECK (mapping_version > 0),
  mapping_spec jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, mapping_version)
);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_snapshot_id uuid REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  source_mapping_id uuid REFERENCES source_mappings(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('queued','running','completed','completedWithErrors','failed','cancelled')),
  control_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calculation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE RESTRICT,
  engine_version text NOT NULL,
  model_schema_version text NOT NULL,
  input_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  issue_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  governing_constraint jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scenario_id, engine_version, input_digest)
);

CREATE TABLE resource_period_results (
  calculation_run_id uuid NOT NULL REFERENCES calculation_runs(id) ON DELETE CASCADE,
  resource_group_id uuid NOT NULL REFERENCES resource_groups(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  load numeric(24,8) NOT NULL,
  capacity numeric(24,8) NOT NULL,
  gap numeric(24,8) NOT NULL,
  utilization numeric(24,12),
  data_state text NOT NULL DEFAULT 'complete' CHECK (data_state IN ('complete','noDemand','notApplicable','missingData','noCapacity')),
  PRIMARY KEY (calculation_run_id, resource_group_id, period_start)
);
CREATE INDEX resource_period_results_constraint_idx ON resource_period_results(calculation_run_id, utilization DESC NULLS LAST);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_entity_idx ON audit_events(tenant_id, entity_type, entity_id, occurred_at DESC);

COMMIT;
