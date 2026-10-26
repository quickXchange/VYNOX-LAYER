import type { AssetNetwork, PublicSite } from '@workspace/api-client-react';

/**
 * Isolated, local-only presentation of the shared Exchange master renderer for the
 * customer Configure Exchange design step. It is NOT a tenant: no slug lookup, no
 * site-config fetch, no quotes, no orders, no writes. Everything below is synthetic.
 */
export const DESIGN_PREVIEW_ROOT = '/__design-preview';
export const MSG_READY = 'vynox:design-preview:ready';
export const MSG_CONFIG = 'vynox:design-preview:config';
export const MSG_CLOSED = 'vynox:design-preview:closed';
/** Query parameter carrying the opaque, random per-preview channel identifier. Not a secret, not PII. */
export const PREVIEW_ID_PARAM = 'pid';
export const PREVIEW_ID_STORAGE_KEY = 'vynox.designPreview.pid';
const PREVIEW_ID = /^[a-f0-9]{32}$/;
export const isPreviewId = (v: unknown): v is string => typeof v === 'string' && PREVIEW_ID.test(v);

/** 128 random bits as hex. Only scopes the same-origin BroadcastChannel; grants nothing. */
export function newPreviewId(rand: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return Array.from(rand(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
}
export const previewChannelName = (id: string) => `vynox-design-preview:${id}`;
export const previewHref = (base: string, id: string) => `${base}${DESIGN_PREVIEW_ROOT}?${PREVIEW_ID_PARAM}=${id}`;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
/** URL id wins (and is remembered for this tab only); otherwise the tab's sessionStorage token. */
export function resolvePreviewId(search: string, storage: StorageLike | null): string | null {
  let fromUrl: string | null = null;
  try { fromUrl = new URLSearchParams(search).get(PREVIEW_ID_PARAM); } catch { /* ignore */ }
  if (isPreviewId(fromUrl)) { try { storage?.setItem(PREVIEW_ID_STORAGE_KEY, fromUrl); } catch { /* ignore */ } return fromUrl; }
  try { const s = storage?.getItem(PREVIEW_ID_STORAGE_KEY); return isPreviewId(s) ? s : null; } catch { return null; }
}

export type BridgeMessage = { v: 1; type: typeof MSG_READY | typeof MSG_CLOSED; id: string } | { v: 1; type: typeof MSG_CONFIG; id: string; config: DesignPreviewConfig };
export const readyMessage = (id: string): BridgeMessage => ({ v: 1, type: MSG_READY, id });
export const closedMessage = (id: string): BridgeMessage => ({ v: 1, type: MSG_CLOSED, id });
export const configMessage = (id: string, config: unknown): BridgeMessage => ({ v: 1, type: MSG_CONFIG, id, config: sanitizeDesignPreview(config) });
/** Accepts only well-formed messages carrying exactly this preview's nonce. */
export function parseBridgeMessage(raw: unknown, id: string): BridgeMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.id !== id || !isPreviewId(id)) return null;
  if (r.type === MSG_READY || r.type === MSG_CLOSED) return { v: 1, type: r.type, id };
  if (r.type === MSG_CONFIG) return { v: 1, type: MSG_CONFIG, id, config: sanitizeDesignPreview(r.config) };
  return null;
}

export type PreviewTheme = 'light' | 'dark' | 'both';
export interface DesignPreviewConfig { brandName: string; primary: string; accent: string; theme: PreviewTheme; logoDataUrl: string | null }

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
const LOGO = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOGO = 12 * 1024 * 1024;

export const DEFAULT_PREVIEW: DesignPreviewConfig = { brandName: 'NovaX', primary: '#12423f', accent: '#b4551f', theme: 'light', logoDataUrl: null };

/** Accepts only well-formed fields; anything invalid keeps the previous valid value. */
export function sanitizeDesignPreview(raw: unknown, prev: DesignPreviewConfig = DEFAULT_PREVIEW): DesignPreviewConfig {
  if (!raw || typeof raw !== 'object') return prev;
  const r = raw as Record<string, unknown>;
  const name = typeof r.brandName === 'string' ? r.brandName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) : '';
  const logo = r.logoDataUrl === null ? null
    : typeof r.logoDataUrl === 'string' && r.logoDataUrl.length <= MAX_LOGO && LOGO.test(r.logoDataUrl) ? r.logoDataUrl : prev.logoDataUrl;
  return {
    brandName: name || DEFAULT_PREVIEW.brandName,
    primary: isHex(r.primary) ? r.primary.toLowerCase() : prev.primary,
    accent: isHex(r.accent) ? r.accent.toLowerCase() : prev.accent,
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'both' ? r.theme : prev.theme,
    logoDataUrl: logo,
  };
}

const a = (assetId: string, symbol: string, name: string, networkId: string, networkName: string): AssetNetwork =>
  ({ assetId, assetNetworkId: `${assetId}-${networkId}`, symbol, name, networkId, networkName, testnet: true, logoUrl: null, decimals: 8 });

/** Synthetic sample assets. Not a catalog, not configured for anyone. */
export const SAMPLE_ASSETS: AssetNetwork[] = [
  a('btc', 'BTC', 'Bitcoin (sample)', 'bitcoin', 'Bitcoin'),
  a('eth', 'ETH', 'Ether (sample)', 'ethereum', 'Ethereum'),
  a('usdt', 'USDT', 'Tether USD (sample)', 'tron', 'Tron'),
  a('usdt', 'USDT', 'Tether USD (sample)', 'ethereum', 'Ethereum'),
  a('sol', 'SOL', 'Solana (sample)', 'solana', 'Solana'),
  a('ltc', 'LTC', 'Litecoin (sample)', 'litecoin', 'Litecoin'),
];

export const SAMPLE_PAYMENT_METHODS = [
  { id: 'card', label: 'Card', note: 'Sample method' },
  { id: 'bank', label: 'Bank transfer', note: 'Sample method' },
  { id: 'sepa', label: 'SEPA instant', note: 'Sample method' },
  { id: 'wallet', label: 'Mobile wallet', note: 'Sample method' },
];

/** Fixed synthetic reference prices in sample fiat units. Never market data. */
export const SAMPLE_PRICE: Record<string, number> = { btc: 61873.4, eth: 3127.85, usdt: 1, sol: 142.37, ltc: 83.19 };
export const samplePrice = (assetId: string) => SAMPLE_PRICE[assetId] ?? 1;

export function previewSite(c: DesignPreviewConfig, assets: AssetNetwork[] = SAMPLE_ASSETS): PublicSite {
  return {
    tenantSlug: DESIGN_PREVIEW_ROOT.slice(1),
    brandName: c.brandName,
    logoUrl: c.logoDataUrl,
    primaryColor: c.primary,
    accentColor: c.accent,
    themeMode: c.theme === 'both' ? 'system' : c.theme,
    domain: null,
    sandboxOnly: true,
    assets,
    features: { crypto_exchange: true, swap: true, convert: true },
    websiteSettings: {
      secondaryColor: '#8a7f6c', faviconUrl: null, fontKey: 'system', sandboxLabel: 'Sandbox Demo',
      heroTitle: `${c.brandName}\nexchange`, heroSubtitle: 'Product simulation with synthetic sample data. No real quotes, payments, orders or transfers.',
      supportEmail: null, supportUrl: null, supportDetails: '', socialLinks: [], footerText: 'Design preview. All figures shown are synthetic samples.',
      privacyContent: '', termsContent: '',
    },
  };
}
