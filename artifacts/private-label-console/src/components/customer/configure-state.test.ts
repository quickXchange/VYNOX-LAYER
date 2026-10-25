import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCfg, stepError, requestDetails } from './configure-state';

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

test('Features permit Swap, Convert or both and require a known provider for Convert', () => {
  const c = initialCfg();
  assert.equal(stepError(2, c), '');
  c.acts = [];
  assert.match(stepError(2, c), /feature/);
  c.acts = ['convert'];
  assert.match(stepError(2, c), /provider/);
  c.convertProviders = ['unknown'];
  assert.match(stepError(2, c), /provider/);
  for (const providers of [['quickex'], ['changenow'], ['quickex', 'changenow']]) {
    c.convertProviders = providers;
    assert.equal(stepError(2, c), '');
    c.acts = ['swap', 'convert'];
    assert.equal(stepError(2, c), '');
  }
});

test('Provider preferences persist in requirements without changing customer text or including hidden selections', () => {
  const c = initialCfg();
  c.details = 'My requirements';
  c.convertProviders = ['quickex', 'changenow'];
  assert.equal(requestDetails(c), 'My requirements');
  c.acts = ['convert'];
  assert.match(requestDetails(c), /Quickex, ChangeNOW/);
  assert.ok(requestDetails(c).endsWith('My requirements'));
  assert.equal(c.details, 'My requirements');
  assert.equal(requestDetails(c), requestDetails(c));
  c.details = 'x'.repeat(10000);
  assert.match(stepError(5, c), /10000/);
});
