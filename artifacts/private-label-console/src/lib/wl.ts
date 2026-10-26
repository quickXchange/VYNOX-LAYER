import { effectiveRecurring, type PlanProfile } from '@/components/plan-management/types';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import type { Addon, WhiteLabelAttachment, WhiteLabelCatalog, WhiteLabelDesign, WhiteLabelEvent, WhiteLabelOrderDetail, WhiteLabelRequest } from '@workspace/api-client-react';

export type Att = WhiteLabelAttachment;
export type WlDesign = WhiteLabelDesign;
export type PricedAddon = Addon;
export type WlOrder = WhiteLabelRequest;
export type WlEvent = WhiteLabelEvent;
export type WlDetail = WhiteLabelOrderDetail;
export type Catalog = WhiteLabelCatalog;

export const STATUS_LABEL: Record<string, string> = { new: 'New', reviewing: 'Reviewing', waiting_for_client: 'Waiting for client', quote_ready: 'Quote ready', approved: 'Approved', in_setup: 'In setup', customization: 'Customization', ready: 'Ready', delivered: 'Delivered', rejected: 'Rejected', cancelled: 'Cancelled', submitted: 'New', provisioned: 'Delivered' };
export const statusText = (s: string) => STATUS_LABEL[s] ?? s;
export const TERMINAL = ['delivered', 'rejected', 'cancelled', 'provisioned'];
export const orderRef = (o: { orderReference?: string; id: string }) => o.orderReference ?? `#${o.id.slice(0, 8)}`;
export const errMsg = (e: unknown) => (e as { data?: { error?: string; message?: string } }).data?.error ?? (e as { data?: { message?: string } }).data?.message ?? (e as Error).message ?? 'Request failed';
const DEC = /^\d+(\.\d{1,2})?$/;
export const toCents = (v: string | null | undefined): bigint => { if (v == null || !DEC.test(v)) return 0n; const [i, f = ''] = v.split('.'); return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2)); };
export const fromCents = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
export const cash = (v: string | null | undefined, c?: string | null) => (v == null || v === '' ? 'Requires review' : !DEC.test(v) ? '-' : `${c ?? ''} ${fromCents(toCents(v))}`.trim());
export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const pctBp = (pct: string | null | undefined): bigint => { const b = toCents(pct); return b > 10000n ? 10000n : b; };
/** Percentage discount on a recurring price only (never setup). BigInt cents, half-up rounding; null stays null. */
export const discounted = (v: string | null | undefined, pct?: string | null): string | null | undefined => (v == null || v === '' || !DEC.test(v) ? v : fromCents((toCents(v) * (10000n - pctBp(pct)) + 5000n) / 10000n));
export const hasDiscount = (pct?: string | null) => pctBp(pct) > 0n;
// Same rule as the server (fixed discount / active promotion / percentage); see effectiveRecurring.
export const periodPrice = (x: { monthlyPrice?: string | null; yearlyPrice?: string | null; discountPercent?: string; profile?: Partial<PlanProfile> | null } | null | undefined, p: string) => {
  if (!x) return undefined;
  const pr = x.profile;
  if (pr && (pr.fixedDiscountAmount || pr.promoPrice)) return effectiveRecurring({ monthlyPrice: x.monthlyPrice ?? null, yearlyPrice: x.yearlyPrice ?? null, discountPercent: x.discountPercent, profile: pr }, p === 'yearly' ? 'yearly' : 'monthly');
  return discounted(p === 'yearly' ? x.yearlyPrice : x.monthlyPrice, x.discountPercent);
};
export const listPrice = (x: { monthlyPrice?: string | null; yearlyPrice?: string | null } | null | undefined, p: string) => (x ? (p === 'yearly' ? x.yearlyPrice : x.monthlyPrice) : undefined);
export const unknownCount = (xs: (string | null | undefined)[]) => xs.filter((v) => v == null || v === '').length;
export const sumNum = (xs: (string | null | undefined)[]) => fromCents(xs.reduce((a, v) => a + toCents(v), 0n));
export const limitText = (v: boolean | string) => (v === true ? 'Included' : v === false ? 'Not included' : String(v));

const API = `${import.meta.env.BASE_URL}api`;
export const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/vnd.microsoft.icon', pdf: 'application/pdf', txt: 'text/plain', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', zip: 'application/zip' };
export const ALLOWED = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'pdf', 'txt', 'docx', 'zip'];
export const MAX_BYTES = 8 * 1024 * 1024;

export function useAttachmentApi() {
  const { getToken } = useAuth();
  const headers = async (): Promise<Record<string, string>> => { const t = await getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };
  const upload = async (file: File, category: string): Promise<Att> => {
    const q = new URLSearchParams({ fileName: file.name, category, contentType: (!file.type || file.type === 'application/octet-stream' ? MIME[file.name.split('.').pop()?.toLowerCase() ?? ''] : file.type) || 'application/octet-stream' });
    const r = await fetch(`${API}/customer/order-attachments?${q}`, { method: 'POST', body: file, credentials: 'include', headers: { ...(await headers()), 'Content-Type': 'application/octet-stream' } });
    if (!r.ok) { const b = await r.json().catch(() => ({})) as { error?: string; message?: string }; throw new Error(b.error ?? b.message ?? `Upload failed (${r.status})`); }
    return r.json();
  };
  const blob = async (id: string, download = false): Promise<Blob> => {
    const r = await fetch(`${API}/customer/order-attachments/${id}/content${download ? '?download=1' : ''}`, { credentials: 'include', headers: await headers() });
    if (!r.ok) throw new Error(`Could not load file (${r.status})`);
    return r.blob();
  };
  return { upload, blob };
}

export function useBlobUrl(id: string | null, enabled: boolean) {
  const api = useAttachmentApi(); const [url, setUrl] = useState<string | null>(null); const [fail, setFail] = useState(false);
  useEffect(() => {
    if (!id || !enabled) return; let u: string | null = null; let dead = false;
    api.blob(id).then((b) => { if (dead) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => !dead && setFail(true));
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);
  return { url, fail };
}
