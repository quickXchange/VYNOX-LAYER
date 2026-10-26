import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREVIEW, previewSite, sanitizeDesignPreview } from './design-preview-bridge';

test('invalid colors keep the last valid preview values', () => {
  const a = sanitizeDesignPreview({ brandName: 'Harbor', primary: '#AA1122', accent: '#00ff00', theme: 'dark', logoDataUrl: null });
  assert.equal(a.primary, '#aa1122');
  const b = sanitizeDesignPreview({ brandName: 'Harbor', primary: '#zz', accent: 'red', theme: 'neon', logoDataUrl: null }, a);
  assert.deepEqual([b.primary, b.accent, b.theme], ['#aa1122', '#00ff00', 'dark']);
});

test('only inline raster image logos are accepted, never remote URLs', () => {
  const ok = sanitizeDesignPreview({ logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.ok(ok.logoDataUrl);
  assert.equal(sanitizeDesignPreview({ logoDataUrl: 'https://example.com/x.png' }).logoDataUrl, null);
  assert.equal(sanitizeDesignPreview({ logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }).logoDataUrl, null);
});

test('preview site is synthetic: sandbox-only, no favicon, no domain, defaults for empty brand', () => {
  const s = previewSite(sanitizeDesignPreview({ brandName: '  ' }));
  assert.equal(s.brandName, DEFAULT_PREVIEW.brandName);
  assert.equal(s.sandboxOnly, true);
  assert.equal(s.websiteSettings.faviconUrl, null);
  assert.equal(s.domain, null);
  assert.ok(s.assets.every((a) => a.testnet));
});

test('preview ids are 128-bit hex, nonce-scoped and remembered per tab only', async () => {
  const { newPreviewId, isPreviewId, resolvePreviewId, PREVIEW_ID_STORAGE_KEY } = await import('./design-preview-bridge');
  const id = newPreviewId(); assert.ok(isPreviewId(id)); assert.notEqual(id, newPreviewId());
  const mem = new Map<string, string>();
  const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  assert.equal(resolvePreviewId(`?pid=${id}`, st), id);
  assert.equal(mem.get(PREVIEW_ID_STORAGE_KEY), id);
  assert.equal(resolvePreviewId('', st), id, 'survives SPA route changes and reload via sessionStorage token');
  assert.equal(resolvePreviewId('?pid=../../etc', { getItem: () => null, setItem: () => {} }), null);
});

test('bridge messages require matching nonce and sanitize config', async () => {
  const { parseBridgeMessage, configMessage, readyMessage, newPreviewId, MSG_CONFIG } = await import('./design-preview-bridge');
  const id = newPreviewId(), other = newPreviewId();
  assert.equal(parseBridgeMessage(readyMessage(other), id), null);
  assert.equal(parseBridgeMessage({ type: MSG_CONFIG, id, config: {} }, id), null, 'version required');
  const m = parseBridgeMessage({ ...configMessage(id, {}), config: { brandName: 'Harbor', primary: 'red', logoDataUrl: 'https://x/y.png' } }, id);
  assert.ok(m && m.type === MSG_CONFIG);
  if (m && m.type === MSG_CONFIG) { assert.equal(m.config.brandName, 'Harbor'); assert.equal(m.config.primary, DEFAULT_PREVIEW.primary); assert.equal(m.config.logoDataUrl, null); }
  assert.equal(DEFAULT_PREVIEW.brandName, 'NovaX');
});
