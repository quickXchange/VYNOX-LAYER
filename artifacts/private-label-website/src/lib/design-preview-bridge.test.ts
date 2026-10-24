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
