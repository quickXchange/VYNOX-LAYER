import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCfg, stepError } from './configure-state';

test('Project requires only brand and preferred domain, not the removed name fields', () => {
  const cfg = initialCfg();
  assert.match(stepError(0, cfg), /Brand name/);
  cfg.brandName = 'Example Exchange';
  assert.match(stepError(0, cfg), /Preferred domain/);
  cfg.domain = '   ';
  assert.match(stepError(0, cfg), /Preferred domain/);
  cfg.domain = 'exchange.example.com';
  assert.equal(stepError(0, cfg), '');
});

test('New configure state no longer carries a favicon and file limits ignore it', () => {
  const cfg = initialCfg();
  assert.equal('favicon' in cfg, false);
});
