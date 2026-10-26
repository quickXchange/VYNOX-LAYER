-- Corrective, idempotent: seeded tiers claimed per-pair markup as available, but no
-- backend exists. Touches ONLY seed-authored rows that nobody has edited since
-- (revision 0, updated_by migration). Later operator edits are never overwritten.
UPDATE public.plans p SET
  profile = jsonb_set(p.profile, '{capabilities}', (
    SELECT jsonb_agg(CASE WHEN c->>'key' = 'pair_markup' THEN c || '{"availability":"unavailable","note":"Requires implementation"}'::jsonb ELSE c END ORDER BY o)
    FROM jsonb_array_elements(p.profile->'capabilities') WITH ORDINALITY AS t(c, o))),
  revision = p.revision + 1, updated_at = now(), updated_by = 'migration:plan-management-capability-fix'
WHERE p.revision = 0 AND p.updated_by = 'migration:plan-management'
  AND jsonb_typeof(p.profile->'capabilities') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.profile->'capabilities') c WHERE c->>'key' = 'pair_markup' AND c->>'availability' <> 'unavailable');
