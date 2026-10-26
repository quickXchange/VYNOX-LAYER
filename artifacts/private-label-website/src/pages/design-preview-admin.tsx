import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Coins, CreditCard, ListOrdered, Palette, RotateCcw, ShieldAlert } from 'lucide-react';
import { ADMIN_ROOT, PreviewBanner, usePreviewModel } from './design-preview';
import { DESIGN_PREVIEW_ROOT, SAMPLE_ASSETS, isHex } from '@/lib/design-preview-bridge';
import { assetNetKey, SIM_TRANSITIONS, simDispatch, useSimState, type SimOrder, type SimOrderStatus } from '@/lib/sim-store';

const fmt = (n: number) => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(6));
const time = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
const STATUS_TONE: Record<SimOrderStatus, string> = {
  submitted: 'bg-sky-100 text-sky-900', processing: 'bg-amber-100 text-amber-900', completed: 'bg-emerald-100 text-emerald-900', failed: 'bg-rose-100 text-rose-900', cancelled: 'bg-stone-200 text-stone-700',
};
const Pill = ({ s }: { s: SimOrderStatus }) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_TONE[s]}`} data-testid={`status-${s}`}>{s}</span>;
const SECTIONS = [
  { id: 'orders', label: 'Orders', icon: ListOrdered },
  { id: 'assets', label: 'Assets & rates', icon: Coins },
  { id: 'payments', label: 'Payment methods', icon: CreditCard },
  { id: 'branding', label: 'Branding & theme', icon: Palette },
  { id: 'reset', label: 'Reset demo', icon: RotateCcw },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="rounded-xl border border-stone-300/70 bg-[#fffdf8] p-5 shadow-[0_1px_0_rgba(60,40,20,0.04)]"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{hint && <p className="mt-1 text-sm text-stone-600">{hint}</p>}<div className="mt-4">{children}</div></section>;
}

function Orders() {
  const s = useSimState();
  if (!s.orders.length) return <Card title="Orders"><div className="rounded-lg border border-dashed p-8 text-center text-sm text-stone-600">No demo orders yet. <Link href={`${DESIGN_PREVIEW_ROOT}/swap`} className="font-semibold underline">Run a Swap</Link> on the website to see it here.</div></Card>;
  return (
    <Card title="Orders (simulation)" hint="Seeded samples plus every order you completed in the website widget this tab. Amounts only; no names, emails or references are kept.">
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm" data-testid="table-sim-orders">
        <thead><tr className="border-b text-left text-[11px] uppercase tracking-wider text-stone-500"><th className="py-2">Ref</th><th>Action</th><th>Pays</th><th>Receives</th><th>Status</th><th>Created</th><th /></tr></thead>
        <tbody>{s.orders.map((o) => (
          <tr key={o.ref} className="border-b border-stone-200 last:border-0 hover:bg-stone-50" data-testid={`row-order-${o.ref}`}>
            <td className="py-2.5 font-mono text-xs">{o.ref}{o.source === 'seed' && <span className="ml-1.5 text-[10px] text-stone-500">seed</span>}</td>
            <td>{o.action}</td><td className="tabular-nums">{fmt(o.payAmount)} {o.paySymbol}</td><td className="tabular-nums">{fmt(o.receiveAmount)} {o.receiveSymbol}</td>
            <td><Pill s={o.status} /></td><td className="text-stone-500">{time(o.createdAt)}</td>
            <td className="text-right"><Link href={`${ADMIN_ROOT}/orders/${o.ref}`} className="font-semibold underline" data-testid={`link-order-${o.ref}`}>Open</Link></td>
          </tr>))}</tbody>
      </table></div>
    </Card>);
}

function OrderDetail({ order }: { order: SimOrder | undefined }) {
  if (!order) return <Card title="Order not found"><p className="text-sm text-stone-600">This demo record does not exist in this tab (it may have been cleared by reload or reset).</p><Link href={`${ADMIN_ROOT}/orders`} className="mt-3 inline-block font-semibold underline">Back to orders</Link></Card>;
  const next = SIM_TRANSITIONS[order.status];
  const rows: [string, string][] = [['Action', order.action], ['Pays', `${fmt(order.payAmount)} ${order.paySymbol}`], ['Receives', `${fmt(order.receiveAmount)} ${order.receiveSymbol}`], ['Sample rate', fmt(order.rate)], ['Sample fee', `${fmt(order.fee)} ${order.receiveSymbol}`], ['Sample method', order.method ?? 'n/a'], ['Origin', order.source === 'seed' ? 'Seeded sample' : 'Completed in website widget']];
  return (
    <div className="space-y-4" data-testid="panel-order-detail">
      <Link href={`${ADMIN_ROOT}/orders`} className="inline-flex items-center gap-1.5 text-sm font-semibold"><ArrowLeft size={15} />All orders</Link>
      <Card title={`${order.ref} (simulation)`} hint="Status changes only update this tab's demo record. No customer is notified, no provider or blockchain is contacted.">
        <div className="flex flex-wrap items-center gap-3"><Pill s={order.status} />
          {next.length ? next.map((st) => <button key={st} type="button" onClick={() => simDispatch({ type: 'setStatus', ref: order.ref, status: st, at: Date.now() })} className="rounded-md border border-stone-400 bg-white px-3 py-1.5 text-sm font-medium capitalize hover:bg-stone-100" data-testid={`button-status-${st}`}>Mark {st}</button>) : <span className="text-sm text-stone-500">Final status. No further transitions.</span>}
        </div>
        <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-stone-200 py-1.5"><dt className="text-stone-500">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>)}</dl>
        <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-stone-500">History</h3>
        <ol className="mt-2 space-y-1.5 text-sm">{order.history.map((h, i) => <li key={i} className="flex items-center gap-3"><span className="font-mono text-xs text-stone-500">{time(h.at)}</span><Pill s={h.status} /></li>)}</ol>
      </Card>
    </div>);
}

function Assets() {
  const s = useSimState();
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <Card title="Sample assets & rates" hint="Synthetic catalogue and fixed sample prices in fiat units. Changes apply to the website simulator immediately. Not market data. At least two distinct assets stay enabled.">
      <div className="space-y-2">{SAMPLE_ASSETS.map((a) => { const k = assetNetKey(a); const on = !s.disabledAssets.includes(k); return (
        <div key={k} className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-3 py-2">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={on} onChange={() => simDispatch({ type: 'toggleAsset', assetNetworkId: k })} data-testid={`toggle-asset-${k}`} /><span className="font-semibold">{a.symbol}</span><span className="text-stone-500">{a.networkName}</span></label>
          <span className="text-xs text-stone-500">Price (sample fiat)</span>
          <input className="w-32 rounded-md border border-stone-300 bg-white px-2 py-1 text-right font-mono text-sm" inputMode="decimal" value={draft[k] ?? String(s.prices[a.assetId])}
            onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, [k]: v })); const n = Number(v); if (v.trim() && Number.isFinite(n) && n > 0) simDispatch({ type: 'setPrice', assetId: a.assetId, price: n }); }}
            onBlur={() => setDraft((d) => { const n = { ...d }; delete n[k]; return n; })} aria-label={`${a.symbol} ${a.networkName} sample price`} data-testid={`input-price-${k}`} />
        </div>); })}</div>
      <p className="mt-3 text-xs text-stone-500">Prices are per asset, so USDT on Tron and Ethereum share one sample price.</p>
    </Card>);
}

function Payments() {
  const s = useSimState();
  return (
    <Card title="Sample payment methods" hint="Shown in the Swap step of the website simulator. No payment provider is connected and no payment instructions are generated.">
      <div className="space-y-2">{s.methods.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-3 py-2">
          <input type="checkbox" checked={m.enabled} onChange={() => simDispatch({ type: 'toggleMethod', id: m.id })} aria-label={`Enable ${m.label}`} data-testid={`toggle-method-${m.id}`} />
          <input className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm" defaultValue={m.label} maxLength={40} onBlur={(e) => simDispatch({ type: 'renameMethod', id: m.id, label: e.target.value })} aria-label={`${m.id} label`} data-testid={`input-method-${m.id}`} />
          <span className="text-xs text-stone-500">{m.enabled ? 'Shown' : 'Hidden'}</span>
        </div>))}</div>
    </Card>);
}

function Branding() {
  const s = useSimState();
  const { site } = usePreviewModel();
  const [name, setName] = useState(s.branding.brandName ?? '');
  const color = (k: 'primary' | 'accent', label: string, cur: string) => (
    <label className="flex items-center gap-2 text-sm">{label}<input type="color" value={cur} onChange={(e) => isHex(e.target.value) && simDispatch({ type: 'setBranding', branding: { [k]: e.target.value } })} className="h-9 w-12 cursor-pointer rounded border" data-testid={`picker-sim-${k}`} /><span className="font-mono text-xs uppercase">{cur}</span></label>);
  return (
    <Card title="Branding & theme (simulation)" hint="Adjust the preview only. These overrides live in this tab and do not change your purchase draft. The logo comes from your draft and cannot be changed here.">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm">Brand name<input className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1.5" value={name} maxLength={100} placeholder={site.brandName} onChange={(e) => { setName(e.target.value); simDispatch({ type: 'setBranding', branding: { brandName: e.target.value } }); }} data-testid="input-sim-brand" /></label>
        <fieldset className="text-sm"><legend>Theme</legend><div className="mt-1 inline-flex gap-1 rounded-md border p-1">{(['light', 'dark', 'both'] as const).map((t) => <button key={t} type="button" aria-pressed={(s.branding.theme ?? (site.themeMode === 'system' ? 'both' : site.themeMode)) === t} onClick={() => simDispatch({ type: 'setBranding', branding: { theme: t } })} className="rounded px-3 py-1 capitalize aria-pressed:bg-stone-900 aria-pressed:text-stone-50" data-testid={`button-sim-theme-${t}`}>{t}</button>)}</div></fieldset>
        {color('primary', 'Primary', site.primaryColor ?? '#12423f')}
        {color('accent', 'Accent', site.accentColor ?? '#b4551f')}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={DESIGN_PREVIEW_ROOT} className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-semibold text-stone-50">View website</Link>
        <button type="button" onClick={() => { setName(''); simDispatch({ type: 'clearBranding' }); }} className="rounded-md border border-stone-400 px-3 py-1.5 text-sm font-medium" data-testid="button-sim-branding-clear">Use purchase draft values</button>
      </div>
    </Card>);
}

function Reset() {
  const [done, setDone] = useState(false);
  return (
    <Card title="Reset demo" hint="Restores seeded orders, sample assets, prices, payment methods and clears branding overrides. Reloading this tab or closing it has the same effect. Your purchase draft is not affected.">
      <button type="button" onClick={() => { simDispatch({ type: 'reset', at: Date.now() }); setDone(true); }} className="inline-flex items-center gap-2 rounded-md bg-rose-800 px-4 py-2 text-sm font-semibold text-rose-50" data-testid="button-sim-reset"><RotateCcw size={15} />Reset simulation</button>
      {done && <p role="status" className="mt-3 text-sm text-emerald-800">Simulation reset.</p>}
    </Card>);
}

export function DesignPreviewAdmin() {
  const params = useParams<{ section?: string; ref?: string }>();
  const s = useSimState();
  const { site } = usePreviewModel();
  const section: Section = params.ref ? 'orders' : (SECTIONS.find((x) => x.id === params.section)?.id ?? 'orders');
  return (
    <div className="min-h-[100dvh] bg-[#f4efe4] text-stone-900" style={{ fontFamily: '"DM Sans", ui-sans-serif, system-ui' }}>
      <PreviewBanner admin />
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-6 p-4 md:grid-cols-[230px_minmax(0,1fr)] md:p-6">
        <aside className="min-w-0 md:sticky md:top-20 md:self-start">
          <div className="flex items-center gap-2.5 rounded-xl border border-stone-300/70 bg-[#fffdf8] p-3">
            {site.logoUrl ? <img src={site.logoUrl} alt="" className="h-8 w-8 rounded object-contain" /> : <span className="grid h-8 w-8 place-items-center rounded font-bold text-white" style={{ background: site.primaryColor ?? '#12423f' }}>{site.brandName.slice(0, 1)}</span>}
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{site.brandName}</p><p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Admin · simulation</p></div>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto md:flex-col" aria-label="Admin sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => <Link key={id} href={`${ADMIN_ROOT}/${id}`} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${section === id ? 'bg-stone-900 text-stone-50' : 'hover:bg-stone-200/70'}`} data-testid={`link-admin-${id}`}><Icon size={16} />{label}{id === 'orders' && <span className="ml-auto text-xs opacity-70">{s.orders.length}</span>}</Link>)}
          </nav>
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><ShieldAlert size={14} className="mb-1" />Users, KYC, payouts, API keys, providers, notifications and reports are not available in this simulation.</div>
        </aside>
        <main className="min-w-0 space-y-4" data-testid={`admin-section-${section}`}>
          {params.ref ? <OrderDetail order={s.orders.find((o) => o.ref === params.ref)} />
            : section === 'orders' ? <Orders /> : section === 'assets' ? <Assets /> : section === 'payments' ? <Payments /> : section === 'branding' ? <Branding /> : <Reset />}
        </main>
      </div>
    </div>);
}
