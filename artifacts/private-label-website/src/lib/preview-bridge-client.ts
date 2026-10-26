import { useSyncExternalStore } from 'react';
import { DEFAULT_PREVIEW, MSG_CLOSED, MSG_CONFIG, parseBridgeMessage, previewChannelName, readyMessage, resolvePreviewId, type DesignPreviewConfig } from './design-preview-bridge';

/**
 * Receiving side of the purchase-draft -> standalone preview bridge.
 * Same-origin BroadcastChannel scoped by a random per-preview nonce. The sanitized config is
 * cached in this module (memory only) so it survives SPA route changes; it is never persisted.
 * Only the opaque nonce is kept in sessionStorage so a reload can reconnect.
 */
export type BridgeStatus = 'connecting' | 'live' | 'standalone' | 'unsupported' | 'closed' | 'timeout';
export interface BridgeSnapshot { cfg: DesignPreviewConfig; status: BridgeStatus; received: boolean }

const WAIT_MS = 2500;
let snap: BridgeSnapshot = { cfg: DEFAULT_PREVIEW, status: 'connecting', received: false };
const subs = new Set<() => void>();
let started = false;
let channel: BroadcastChannel | null = null;
let previewId: string | null = null;
let timer: number | undefined;

const set = (p: Partial<BridgeSnapshot>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };
const arm = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (snap.status === 'connecting') set({ status: 'timeout' }); }, WAIT_MS); };

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let storage: Storage | null = null;
  try { storage = window.sessionStorage; } catch { storage = null; }
  previewId = resolvePreviewId(window.location.search, storage);
  if (!previewId) { set({ status: 'standalone' }); return; }
  if (typeof BroadcastChannel === 'undefined') { set({ status: 'unsupported' }); return; }
  const id = previewId;
  channel = new BroadcastChannel(previewChannelName(id));
  channel.onmessage = (e) => {
    const m = parseBridgeMessage(e.data, id);
    if (!m) return;
    if (m.type === MSG_CONFIG) { window.clearTimeout(timer); set({ cfg: m.config, status: 'live', received: true }); }
    else if (m.type === MSG_CLOSED) set({ status: 'closed' });
  };
  channel.postMessage(readyMessage(id)); arm();
  // Re-ask when the tab regains focus, in case the purchase page was reopened or remounted.
  window.addEventListener('focus', () => { if (snap.status !== 'live') reconnect(); });
}

export function reconnect() {
  if (!channel || !previewId) return;
  set({ status: 'connecting' }); channel.postMessage(readyMessage(previewId)); arm();
}

const subscribe = (f: () => void) => { start(); subs.add(f); return () => { subs.delete(f); }; };
const get = () => snap;
export const useBridge = () => useSyncExternalStore(subscribe, get, get);
