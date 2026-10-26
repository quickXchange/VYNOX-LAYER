import { useSyncExternalStore } from 'react';
import { SAMPLE_ASSETS, SAMPLE_PAYMENT_METHODS, SAMPLE_PRICE, isHex, type DesignPreviewConfig, type PreviewTheme } from './design-preview-bridge';

/**
 * In-memory demo state for the standalone design-preview SIMULATION (website + admin).
 * Lives only in this JS module for this tab: reload or "Reset demo" clears it. Never written to
 * a server, localStorage, sessionStorage or URL. Orders hold no name, email or wallet/reference.
 */
export type SimOrderStatus = 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled';
export const SIM_TRANSITIONS: Record<SimOrderStatus, SimOrderStatus[]> = {
  submitted: ['processing', 'cancelled'], processing: ['completed', 'failed', 'cancelled'], completed: [], failed: [], cancelled: [],
};
export interface SimOrder {
  ref: string; clientId: string; source: 'widget' | 'seed'; action: 'Swap' | 'Convert';
  payAmount: number; paySymbol: string; receiveAmount: number; receiveSymbol: string; rate: number; fee: number; method: string | null;
  status: SimOrderStatus; createdAt: number; history: { status: SimOrderStatus; at: number }[];
}
export type NewSimOrder = Omit<SimOrder, 'ref' | 'status' | 'createdAt' | 'history' | 'source'>;
export interface SimMethod { id: string; label: string; note: string; enabled: boolean }
export interface SimBranding { brandName?: string; primary?: string; accent?: string; theme?: PreviewTheme }
export interface SimState { seq: number; orders: SimOrder[]; disabledAssets: string[]; prices: Record<string, number>; methods: SimMethod[]; branding: SimBranding }

export type SimAction =
  | { type: 'addOrder'; order: NewSimOrder; at: number }
  | { type: 'setStatus'; ref: string; status: SimOrderStatus; at: number }
  | { type: 'toggleAsset'; assetNetworkId: string }
  | { type: 'setPrice'; assetId: string; price: number }
  | { type: 'toggleMethod'; id: string }
  | { type: 'renameMethod'; id: string; label: string }
  | { type: 'setBranding'; branding: SimBranding }
  | { type: 'clearBranding' }
  | { type: 'reset'; at: number };

export const assetNetKey = (a: { assetId: string; assetNetworkId?: string | null }) => a.assetNetworkId ?? a.assetId;
const ref = (n: number) => `SIM-${String(n).padStart(5, '0')}`;
function seed(at: number): SimOrder[] {
  const mk = (n: number, o: Omit<SimOrder, 'ref' | 'clientId' | 'source' | 'createdAt' | 'history'>, mins: number): SimOrder =>
    ({ ...o, ref: ref(n), clientId: `seed-${n}`, source: 'seed', createdAt: at - mins * 60_000, history: [{ status: o.status, at: at - mins * 60_000 }] });
  return [
    mk(2, { action: 'Convert', payAmount: 0.08, paySymbol: 'ETH', receiveAmount: 0.0040301, receiveSymbol: 'BTC', rate: 0.050552, fee: 0.0000141, method: null, status: 'processing' }, 14),
    mk(1, { action: 'Swap', payAmount: 250, paySymbol: 'fiat', receiveAmount: 1.7499, receiveSymbol: 'SOL', rate: 142.37, fee: 0.006146, method: 'Card', status: 'completed' }, 52),
  ];
}
export function initialSimState(at = Date.now()): SimState {
  return { seq: 2, orders: seed(at), disabledAssets: [], prices: { ...SAMPLE_PRICE }, methods: SAMPLE_PAYMENT_METHODS.map((m) => ({ ...m, enabled: true })), branding: {} };
}

const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
export function simReducer(s: SimState, a: SimAction): SimState {
  switch (a.type) {
    case 'addOrder': {
      const o = a.order;
      if (!o.clientId || s.orders.some((x) => x.clientId === o.clientId)) return s; // exactly once per completion
      if (![o.payAmount, o.receiveAmount, o.rate, o.fee].every(num)) return s;
      const seq = s.seq + 1;
      const order: SimOrder = {
        clientId: o.clientId, action: o.action, payAmount: o.payAmount, paySymbol: o.paySymbol, receiveAmount: o.receiveAmount, receiveSymbol: o.receiveSymbol,
        rate: o.rate, fee: o.fee, method: o.method, ref: ref(seq), source: 'widget', status: 'submitted', createdAt: a.at, history: [{ status: 'submitted', at: a.at }],
      };
      return { ...s, seq, orders: [order, ...s.orders] };
    }
    case 'setStatus': return { ...s, orders: s.orders.map((o) => o.ref === a.ref && SIM_TRANSITIONS[o.status].includes(a.status) ? { ...o, status: a.status, history: [...o.history, { status: a.status, at: a.at }] } : o) };
    case 'toggleAsset': {
      const disabled = s.disabledAssets.includes(a.assetNetworkId) ? s.disabledAssets.filter((x) => x !== a.assetNetworkId) : [...s.disabledAssets, a.assetNetworkId];
      const ids = new Set(SAMPLE_ASSETS.filter((x) => !disabled.includes(assetNetKey(x))).map((x) => x.assetId));
      return ids.size < 2 ? s : { ...s, disabledAssets: disabled }; // Convert needs two distinct assets
    }
    case 'setPrice': return a.assetId in s.prices && num(a.price) && a.price > 0 && a.price < 1e9 ? { ...s, prices: { ...s.prices, [a.assetId]: a.price } } : s;
    case 'toggleMethod': return { ...s, methods: s.methods.map((m) => m.id === a.id ? { ...m, enabled: !m.enabled } : m) };
    case 'renameMethod': { const l = a.label.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40); return l ? { ...s, methods: s.methods.map((m) => m.id === a.id ? { ...m, label: l } : m) } : s; }
    case 'setBranding': {
      const b = a.branding, next: SimBranding = { ...s.branding };
      if (typeof b.brandName === 'string') { const n = b.brandName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100); if (n) next.brandName = n; else delete next.brandName; }
      if (isHex(b.primary)) next.primary = b.primary.toLowerCase();
      if (isHex(b.accent)) next.accent = b.accent.toLowerCase();
      if (b.theme === 'light' || b.theme === 'dark' || b.theme === 'both') next.theme = b.theme;
      return { ...s, branding: next };
    }
    case 'clearBranding': return { ...s, branding: {} };
    case 'reset': return initialSimState(a.at);
  }
}

/** Admin overrides win over the purchase-draft config; the logo is never overridable here. */
export const applyBranding = (c: DesignPreviewConfig, b: SimBranding): DesignPreviewConfig => ({ ...c, ...b });
export const enabledAssets = (s: SimState) => SAMPLE_ASSETS.filter((a) => !s.disabledAssets.includes(assetNetKey(a)));
export const enabledMethods = (s: SimState) => s.methods.filter((m) => m.enabled).map(({ id, label, note }) => ({ id, label, note }));

// Module-level store: one per tab, memory only.
let state = initialSimState();
const subs = new Set<() => void>();
export const getSimState = () => state;
export function simDispatch(a: SimAction) { const n = simReducer(state, a); if (n !== state) { state = n; subs.forEach((f) => f()); } }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useSimState = () => useSyncExternalStore(subscribe, getSimState, getSimState);
