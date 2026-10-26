import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPlanPolicy } from './effective-policy';

test('legacy empty-profile contracts are unchanged', () => {
  const features: Record<string, boolean> = { buy: true, pair_markup: true }; const limits: Record<string, string> = { max_staff: '9' };
  applyPlanPolicy({}, features, limits, {}); applyPlanPolicy(undefined, features, limits, {});
  assert.deepEqual(features, { buy: true, pair_markup: true }); assert.deepEqual(limits, { max_staff: '9' });
});
test('structured capabilities grant only implemented, available features', () => {
  const f: Record<string, boolean> = { buy: true }, l: Record<string, string> = {};
  applyPlanPolicy({ slug: 'x', adminSeats: 2, convertProviderLimit: 2, poweredByFooter: true, themeModes: ['light'], capabilities: [
    { key: 'best_rate_routing', state: 'included', availability: 'available' },
    { key: 'api_access', state: 'included', availability: 'available' },
    { key: 'convert_providers', state: 'limited', limitValue: 2, availability: 'requires_configuration' },
    { key: 'order_admin', state: 'included', availability: 'available', dependsOn: ['convert_providers'] },
    { key: 'email_support', state: 'excluded', availability: 'available' },
  ] }, f, l, {});
  assert.equal(f.buy, false); assert.equal(f.best_rate_routing, false); assert.equal(f.api_keys, true);
  assert.equal(f.convert_providers, false); assert.equal(f.order_admin, false, 'dependency removes access');
  assert.equal(f.email_support, false); assert.equal(f.powered_by_footer, true);
  assert.equal(f.theme_light, true); assert.equal(f.theme_dark, false);
  assert.equal(l.max_staff, '1'); assert.equal(l.max_convert_providers, '2'); assert.equal(l.max_languages, '1');
});
test('seeded tiers resolve as intended', () => {
  const sql = readFileSync(new URL('../../../../../lib/db/migrations/plan-management-seed.sql', import.meta.url), 'utf8');
  const [s, st, p] = [...sql.matchAll(/\$j\$(.*?)\$j\$/gs)].map(m => { const f: Record<string, boolean> = {}, l: Record<string, string> = {}; applyPlanPolicy(JSON.parse(m[1]), f, l, {}); return { f, l }; });
  assert.equal(s.f.powered_by_footer, true); assert.equal(st.f.powered_by_footer, false);
  assert.equal(s.l.max_convert_providers, '2'); assert.equal(st.l.max_convert_providers, undefined);
  assert.equal(s.l.max_staff, '0'); assert.equal(p.f.api_keys, true); assert.equal(st.f.api_keys, false);
  for (const t of [s, st, p]) { assert.equal(t.f.fiat_ramps, false); assert.equal(t.f.pair_markup, false); }
});
