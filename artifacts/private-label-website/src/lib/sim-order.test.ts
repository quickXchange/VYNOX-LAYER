import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_DETAILS, sampleAmount, amountError, back, detailsErrors, next, simQuote, simRef } from './sim-order';

test('swap fiat in divides by price and deducts sample fee', () => {
  const q = simQuote({ amount: 1000, fromPrice: 500, convert: false, fiatIn: true })!;
  assert.equal(q.gross, 2); assert.ok(Math.abs(q.net - 2 * (1 - 0.0035)) < 1e-12); assert.equal(q.fiatValue, 1000);
});
test('convert uses cross rate', () => {
  const q = simQuote({ amount: 2, fromPrice: 100, toPrice: 50, convert: true, fiatIn: false })!;
  assert.equal(q.gross, 4); assert.equal(q.fiatValue, 200);
});
test('invalid inputs yield no quote', () => {
  assert.equal(simQuote({ amount: 0, fromPrice: 1, convert: false, fiatIn: true }), null);
  assert.equal(simQuote({ amount: 1, fromPrice: 1, convert: true, fiatIn: false }), null);
});
test('amount validation with sample limits', () => {
  assert.ok(amountError('', null)); assert.ok(amountError('10', 10)); assert.ok(amountError('1', 30000));
  assert.equal(amountError('100', 100), null);
});
test('details validation and synthetic defaults pass', () => {
  assert.deepEqual(detailsErrors(SAMPLE_DETAILS), {});
  const e = detailsErrors({ fullName: '', email: 'x', destination: 'a', agree: false });
  assert.ok(e.fullName && e.email && e.destination);
});
test('non-finite inputs are rejected', () => {
  assert.equal(simQuote({ amount: Infinity, fromPrice: 1, convert: false, fiatIn: true }), null);
  assert.equal(simQuote({ amount: NaN, fromPrice: 1, convert: false, fiatIn: true }), null);
  assert.equal(simQuote({ amount: 1, fromPrice: 1, toPrice: Infinity, convert: true, fiatIn: false }), null);
  assert.equal(simQuote({ amount: 1e308, fromPrice: 1e308, convert: false, fiatIn: false }), null);
  assert.ok(amountError('Infinity', null)); assert.ok(amountError('100', Infinity)); assert.ok(amountError('100', NaN));
});
test('sample amount is about 250 fiat and within limits', () => {
  assert.equal(sampleAmount(true, 61873.4), '250');
  const btc = sampleAmount(false, 61873.4); const v = Number(btc) * 61873.4;
  assert.ok(Math.abs(v - 250) < 1); assert.equal(amountError(btc, v), null);
  assert.equal(sampleAmount(false, NaN), '250');
});
test('stage transitions', () => {
  assert.equal(next('amount'), 'details'); assert.equal(next('review'), 'done'); assert.equal(back('details'), 'amount');
  assert.equal(back('amount'), 'amount'); assert.equal(back('done'), 'done'); assert.match(simRef(3), /^SIM-/);
});
