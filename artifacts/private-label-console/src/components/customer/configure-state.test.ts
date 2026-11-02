import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCfg, stepError, requestDetails } from './configure-state';
import { readDraft, draftKey } from './configure-draft';

test('Project rejects malformed hostnames before advancing', () => {
  for (const domain of ['not a valid domain', 'https://example.com', 'a.com/path', 'a.com:443', '-bad.com', 'a..com', 'a.com?x', 'test.replit.dev']) {
    assert.match(stepError(0, { ...initialCfg(), brandName: 'Example', domain }), /valid domain/);
  }
  assert.equal(stepError(0, { ...initialCfg(), brandName: 'Example', domain: 'bücher.example' }), '');
});

test('Draft restoration is identity scoped, expiring and retains retry identity', () => {
  const d = { cfg: { ...initialCfg(), brandName: 'Saved brand' }, step: 1, maxStep: 2,
    key: '12345678-1234-1234-1234-123456789012', savedAt: Date.now() };
  const storage = { getItem: (key: string) => key === draftKey('customer-a') ? JSON.stringify(d) : null };
  assert.deepEqual(readDraft(storage, 'customer-a'), d);
  const attached = { ...d, cfg: { ...d.cfg, reqFiles: [{ id: 'test-file', fileName: 'requirements.txt', size: 90 }] } };
  assert.deepEqual(readDraft({ getItem: () => JSON.stringify(attached) }, 'customer-a'), attached);
  assert.equal(readDraft(storage, 'customer-b'), null);
  d.savedAt -= 86400001;
  assert.equal(readDraft(storage, 'customer-a'), null);
  assert.equal(readDraft({ getItem: () => '{broken' }, 'customer-a'), null);
});

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
