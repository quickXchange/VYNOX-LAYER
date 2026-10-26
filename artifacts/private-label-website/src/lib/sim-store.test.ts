import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBranding, enabledAssets, initialSimState, simReducer, type NewSimOrder } from './sim-store';
import { DEFAULT_PREVIEW, SAMPLE_ASSETS } from './design-preview-bridge';

const order = (clientId: string): NewSimOrder => ({ clientId, action: 'Swap', payAmount: 250, paySymbol: 'fiat', receiveAmount: 0.004, receiveSymbol: 'BTC', rate: 61873.4, fee: 0.00001, method: 'Card' });

test('a completed simulated order is added exactly once and holds no personal fields', () => {
  const s0 = initialSimState(0);
  const s1 = simReducer(s0, { type: 'addOrder', order: order('run-a'), at: 1 });
  const s2 = simReducer(s1, { type: 'addOrder', order: order('run-a'), at: 2 });
  assert.equal(s1.orders.length, s0.orders.length + 1);
  assert.equal(s2, s1);
  const o = s1.orders[0];
  assert.equal(o.status, 'submitted'); assert.equal(o.ref, 'SIM-00003');
  for (const k of ['email', 'fullName', 'destination']) assert.ok(!(k in o));
  const leaky = simReducer(s0, { type: 'addOrder', order: { ...order('run-b'), email: 'a@b.c' } as NewSimOrder, at: 1 });
  assert.ok(!('email' in leaky.orders[0]));
});

test('status transitions follow the allowed graph only', () => {
  let s = simReducer(initialSimState(0), { type: 'addOrder', order: order('x'), at: 1 });
  const r = s.orders[0].ref;
  s = simReducer(s, { type: 'setStatus', ref: r, status: 'completed', at: 2 });
  assert.equal(s.orders[0].status, 'submitted');
  s = simReducer(s, { type: 'setStatus', ref: r, status: 'processing', at: 3 });
  s = simReducer(s, { type: 'setStatus', ref: r, status: 'completed', at: 4 });
  assert.equal(s.orders[0].status, 'completed'); assert.equal(s.orders[0].history.length, 3);
  s = simReducer(s, { type: 'setStatus', ref: r, status: 'cancelled', at: 5 });
  assert.equal(s.orders[0].status, 'completed');
});

test('catalog edits keep two distinct assets and valid prices', () => {
  let s = initialSimState(0);
  for (const a of SAMPLE_ASSETS) s = simReducer(s, { type: 'toggleAsset', assetNetworkId: a.assetNetworkId! });
  assert.equal(new Set(enabledAssets(s).map((a) => a.assetId)).size, 2);
  assert.equal(simReducer(s, { type: 'setPrice', assetId: 'btc', price: -1 }), s);
  assert.equal(simReducer(s, { type: 'setPrice', assetId: 'btc', price: 70000 }).prices.btc, 70000);
});

test('branding overrides are sanitized and reset restores the sample', () => {
  let s = simReducer(initialSimState(0), { type: 'setBranding', branding: { brandName: ' Harbor ', primary: 'red', accent: '#AABBCC', theme: 'dark' } });
  const c = applyBranding(DEFAULT_PREVIEW, s.branding);
  assert.deepEqual([c.brandName, c.primary, c.accent, c.theme], ['Harbor', DEFAULT_PREVIEW.primary, '#aabbcc', 'dark']);
  s = simReducer(s, { type: 'reset', at: 9 });
  assert.deepEqual(s.branding, {}); assert.equal(s.orders.length, 2);
});
