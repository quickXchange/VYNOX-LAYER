import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanFeatureRows, featureRowsError, moveRow, readFeatureRows } from './feature-rows';

test('reads old snapshots safely', () => {
  assert.deepEqual(readFeatureRows({}), []);
  assert.deepEqual(readFeatureRows(null), []);
  assert.deepEqual(readFeatureRows({ featureRows: 'x' }), []);
  assert.deepEqual(readFeatureRows({ featureRows: [{ label: 'Tier', value: 'Starter' }, { label: 1 }, null] }), [{ label: 'Tier', value: 'Starter' }]);
});
test('validates blank and long rows without a small cap', () => {
  assert.match(featureRowsError([{ label: ' ', value: 'a' }]), /label/);
  assert.match(featureRowsError([{ label: 'a', value: '' }]), /value/);
  assert.match(featureRowsError([{ label: 'a'.repeat(121), value: 'b' }]), /120/);
  assert.match(featureRowsError([{ label: 'a', value: 'b'.repeat(501) }]), /500/);
  assert.equal(featureRowsError(Array.from({ length: 60 }, () => ({ label: 'a', value: 'b' }))), '');
});
test('reorders and trims', () => {
  assert.deepEqual(moveRow([1, 2, 3], 0, 2), [2, 3, 1]);
  assert.deepEqual(moveRow([1, 2], 0, -1), [1, 2]);
  assert.deepEqual(cleanFeatureRows([{ label: ' a ', value: ' b ' }]), [{ label: 'a', value: 'b' }]);
});
