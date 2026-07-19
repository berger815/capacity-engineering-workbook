BEGIN;

CREATE TABLE scenario_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  name text NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN ('resourceQuantityDelta','resourceCapacityMultiplier','demandMultiplier')),
  included boolean NOT NULL DEFAULT true,
  action_status text NOT NULL DEFAULT 'proposed' CHECK (action_status IN ('proposed','approved','implemented','rejected')),
  effective_from date NOT NULL,
  effective_to date,
  owner_text text,
  rationale text,
  confidence text CHECK (confidence IN ('high','medium','low','unknown')),
  source text,
  resource_id uuid REFERENCES resources(id) ON DELETE RESTRICT,
  resource_group_id uuid REFERENCES resource_groups(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
  quantity_delta numeric(18,6),
  multiplier numeric(18,8),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (NOT (action_status = 'rejected' AND included)),
  CHECK (
    (action_kind = 'resourceQuantityDelta'
      AND resource_id IS NOT NULL
      AND resource_group_id IS NULL
      AND product_id IS NULL
      AND quantity_delta IS NOT NULL
      AND quantity_delta > 0
      AND multiplier IS NULL)
    OR
    (action_kind = 'resourceCapacityMultiplier'
      AND resource_id IS NULL
      AND resource_group_id IS NOT NULL
      AND product_id IS NULL
      AND quantity_delta IS NULL
      AND multiplier IS NOT NULL
      AND multiplier >= 0)
    OR
    (action_kind = 'demandMultiplier'
      AND resource_id IS NULL
      AND resource_group_id IS NULL
      AND quantity_delta IS NULL
      AND multiplier IS NOT NULL
      AND multiplier >= 0)
  ),
  UNIQUE (scenario_id, action_key)
);

CREATE INDEX scenario_actions_scenario_effectivity_idx
  ON scenario_actions(scenario_id, included, effective_from, effective_to);
CREATE INDEX scenario_actions_resource_idx
  ON scenario_actions(resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX scenario_actions_resource_group_idx
  ON scenario_actions(resource_group_id) WHERE resource_group_id IS NOT NULL;
CREATE INDEX scenario_actions_product_idx
  ON scenario_actions(product_id) WHERE product_id IS NOT NULL;

CREATE TABLE calculation_run_actions (
  calculation_run_id uuid NOT NULL REFERENCES calculation_runs(id) ON DELETE CASCADE,
  scenario_action_id uuid NOT NULL REFERENCES scenario_actions(id) ON DELETE RESTRICT,
  action_snapshot jsonb NOT NULL,
  PRIMARY KEY (calculation_run_id, scenario_action_id)
);

CREATE TABLE scenario_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  baseline_calculation_run_id uuid NOT NULL REFERENCES calculation_runs(id) ON DELETE RESTRICT,
  comparison_calculation_run_id uuid NOT NULL REFERENCES calculation_runs(id) ON DELETE RESTRICT,
  resolved_gap_periods integer NOT NULL CHECK (resolved_gap_periods >= 0),
  remaining_gap_periods integer NOT NULL CHECK (remaining_gap_periods >= 0),
  worsened_gap_periods integer NOT NULL CHECK (worsened_gap_periods >= 0),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (baseline_calculation_run_id <> comparison_calculation_run_id)
);

CREATE INDEX scenario_comparisons_tenant_created_idx
  ON scenario_comparisons(tenant_id, created_at DESC);

COMMIT;
