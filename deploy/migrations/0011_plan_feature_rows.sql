-- Operator-only additive migration, inside the operator's verified transaction.
-- No startup DDL, record replacement, grant or policy changes.
ALTER TABLE public.plans
  ADD COLUMN feature_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT plans_feature_rows_array CHECK (jsonb_typeof(feature_rows) = 'array');

-- Acceptance may already exist (0010 was applied privately) or may be created
-- later. In the latter case immutable 0010 LIKE INCLUDING ALL inherits this
-- column, default and check; never register 0010 in the generic manifest.
DO $plan_feature_rows$
BEGIN
  IF to_regclass('qxlayer_acceptance_catalog.plans') IS NOT NULL THEN
    ALTER TABLE qxlayer_acceptance_catalog.plans
      ADD COLUMN feature_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD CONSTRAINT plans_feature_rows_array CHECK (jsonb_typeof(feature_rows) = 'array');
  END IF;
END
$plan_feature_rows$;
