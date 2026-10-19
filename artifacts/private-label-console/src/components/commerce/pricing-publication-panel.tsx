import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useListEntitlementDefinitions } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, ListSkeleton } from '@/components/app/bits';
import { Panel, Pill } from '@/components/super-admin/kit';
import { groupOf } from '@/components/app/entitlement-editor';
import { useInvalidateCatalog } from '@/lib/invalidate';
import { useToast } from '@/hooks/use-toast';
import { useCommerceApi } from './api';
import { readFeatureRows } from '@/lib/feature-rows';

type Snap = { plans: Item[]; addons: Item[]; methods: Item[]; purchaseAvailable: boolean };
type Item = Record<string, unknown> & { id?: string };
type Pub = { draftRevision: string; publishedRevision: string | null; publishedAt: string | null; draft: Snap; published: Snap | null };
const KEY = ['commerce', 'pricing-publication'];
const s = (v: unknown) => (v == null || v === '' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const byId = (l: Item[] | undefined) => new Map((l ?? []).map((x) => [String(x.id ?? x.name), x]));

function Prices({ it }: { it?: Item }) {
  if (!it) return <span className="text-muted-foreground">Not published</span>;
  const cur = s(it.currency);
  const raw = Array.isArray(it.billingPeriods) ? it.billingPeriods : Array.isArray(it.periods) ? it.periods : [];
  const periods = raw.map((p) => typeof p === 'string' ? ({ label: p.charAt(0).toUpperCase() + p.slice(1) }) : p as Item);
  return <span className="font-mono text-xs">
    {it.monthlyPrice == null && it.yearlyPrice == null ? 'Unconfigured' : <>{s(it.monthlyPrice)} / mo<br />{s(it.yearlyPrice)} / yr<br />{s(it.setupFee)} setup {cur}</>}
    {Number(it.discountPercent) > 0 && <><br />{s(it.discountPercent)}% off recurring</>}
    {it.billingLabel ? <><br />{s(it.billingLabel)}</> : null}
    {periods.length > 0 && <span className="block">Billing periods: {periods.map((p) => s(p.label ?? p.name ?? p.months ?? p.period) + (p.price ?? p.amount ? ` ${s(p.price ?? p.amount)} ${cur}` : '')).join(', ')}</span>}
  </span>;
}

function Feats({ it, label }: { it?: Item; label: (k: string) => string }) {
  const e = Array.isArray(it?.entitlements) ? it!.entitlements as { key: string; value: unknown }[] : [];
  if (!it) return <span className="text-muted-foreground">-</span>;
  const rows = readFeatureRows(it);
  const rowsEl = rows.length > 0 && <dl className="mb-1 space-y-0.5 border-l-2 pl-2 text-xs" data-testid="list-pub-feature-rows">{rows.map((r, i) => <div key={i} className="flex gap-2"><dt className="text-muted-foreground">{r.label}</dt><dd className="min-w-0 break-words">{r.value}</dd></div>)}</dl>;
  if (e.length === 0) return <>{rowsEl}<span className="text-xs text-muted-foreground">No entitlements</span></>;
  return <>{rowsEl}<ul className="space-y-0.5 text-xs">{e.map((x) => <li key={x.key} data-testid={`feat-${x.key}`} className={x.value === false ? 'text-muted-foreground line-through' : ''}>{label(x.key)}{x.value === true ? ': on' : x.value === false ? ': revoked (off)' : `: limit ${s(x.value)}`}{groupOf(x.key) !== 'General' && <span className="ml-1 font-mono text-[10px] text-copper">{groupOf(x.key)}</span>}</li>)}</ul></>;
}

function Compare({ title, draft, pub, label }: { title: string; draft: Item[]; pub: Item[] | undefined; label: (k: string) => string }) {
  const pm = byId(pub); const dm = byId(draft);
  const ids = [...new Set([...dm.keys(), ...pm.keys()])];
  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{title} ({ids.length})</p>
      {ids.length === 0 ? <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">None in the draft or public snapshot.</p> : (
        <div className="divide-y rounded-md border">
          {ids.map((id) => { const d = dm.get(id); const p = pm.get(id); const removed = !d; const changed = JSON.stringify(p) !== JSON.stringify(d); const name = s((d ?? p)?.name); return (
            <div key={id} className="grid gap-3 p-3 text-sm md:grid-cols-[1fr_1fr_1fr]" data-testid={`row-pub-${title}-${id}`}>
              <div><p className="font-display text-lg">{name}</p><div className="flex flex-wrap gap-1">{d && <Pill>{s(d.status ?? (d.enabled === false ? 'disabled' : 'enabled'))}</Pill>}{changed && <Pill tone="warn">{removed ? 'Will be unpublished' : p ? 'Changed' : 'New'}</Pill>}</div></div>
              <div><p className="mb-1 text-[11px] uppercase text-muted-foreground">Public now</p><Prices it={p} /><div className="mt-2"><Feats it={p} label={label} /></div></div>
              <div><p className="mb-1 text-[11px] uppercase text-muted-foreground">Draft (preview)</p>{removed ? <p className="text-sm font-medium text-destructive" data-testid={`text-unpublish-${id}`}>Will be unpublished</p> : <><Prices it={d} /><div className="mt-2"><Feats it={d} label={label} /></div></>}</div>
            </div>); })}
        </div>)}
    </div>
  );
}

export function PricingPublicationPanel() {
  const call = useCommerceApi(); const qc = useQueryClient(); const inv = useInvalidateCatalog(); const { toast } = useToast();
  const defs = useListEntitlementDefinitions();
  const label = (k: string) => defs.data?.find((d) => d.key === k)?.label ?? k;
  const q = useQuery({ queryKey: KEY, queryFn: () => call<Pub>('GET', '/commerce/pricing-publication'), staleTime: 10000 });
  const [reason, setReason] = useState(''); const [ok, setOk] = useState(false); const [err, setErr] = useState<string | null>(null);
  const pub = useMutation({
    mutationFn: (b: { expectedRevision: string; expectedPublishedRevision: string | null; reason: string }) => call<unknown>('POST', '/commerce/pricing-publication', b),
    onSuccess: () => { setOk(false); setReason(''); setErr(null); void qc.invalidateQueries({ queryKey: KEY }); inv(); void qc.invalidateQueries({ queryKey: ['public', 'published-plans'] }); void qc.invalidateQueries({ predicate: (x) => /public|catalog/i.test(String(x.queryKey[0])) }); toast({ title: 'Pricing published' }); },
    onError: (e) => { setOk(false); setErr(/409|stale|conflict|revision/i.test((e as Error).message) ? `The draft changed since you reviewed it. It was refreshed; review the new draft and confirm again. (${(e as Error).message})` : (e as Error).message); void qc.invalidateQueries({ queryKey: KEY }); },
  });
  const d = q.data;
  const same = !!d && d.publishedRevision === d.draftRevision;
  const can = !!d && ok && reason.trim().length >= 3 && !pub.isPending && !same;
  return (
    <Panel title="Pricing publication" note="Saving a plan or add-on updates entitlements of assigned tenants immediately; Publish controls public pricing and catalog only. Saves change the draft only. The public site keeps showing the published snapshot until you publish. This publishes pricing data only; it does not deploy, change DNS or activate payments.">
      {q.isLoading ? <ListSkeleton /> : q.isError || !d ? <ErrorState what="pricing publication" onRetry={() => q.refetch()} /> : (
        <div className="space-y-5" data-testid="panel-pricing-publication">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={same ? 'ok' : 'warn'}>{same ? 'Draft matches public' : 'Unpublished changes'}</Pill>
            <span className="font-mono text-xs text-muted-foreground" data-testid="text-draft-revision">draft {d.draftRevision.slice(0, 12)}</span>
            <span className="font-mono text-xs text-muted-foreground" data-testid="text-published-revision">{d.publishedRevision ? `public ${d.publishedRevision.slice(0, 12)}${d.publishedAt ? ` · ${new Date(d.publishedAt).toLocaleString()}` : ''}` : 'Nothing published yet'}</span>
            <Pill tone={d.draft.purchaseAvailable ? 'ok' : 'warn'}>{d.draft.purchaseAvailable ? 'Purchase available in draft' : 'Purchase unavailable in draft'}</Pill>
            <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-publication">Refresh</Button>
          </div>
          <Compare title="Plans" draft={d.draft.plans} pub={d.published?.plans} label={label} />
          <Compare title="Add-ons" draft={d.draft.addons} pub={d.published?.addons} label={label} />
          <Compare title="Payment methods" draft={d.draft.methods} pub={d.published?.methods} label={label} />
          <div className="space-y-3 rounded-md border p-4">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ok} disabled={same} onChange={(e) => setOk(e.target.checked)} data-testid="check-confirm-publish" />
              <span>I reviewed the draft above and understand publishing makes these prices, billing periods, currencies and features visible publicly.</span></label>
            <label className="block text-sm"><span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Reason (audited, 3+ characters)</span>
              <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="input-publish-reason" /></label>
            {err && <p role="alert" className="text-sm text-destructive" data-testid="text-publish-error">{err}</p>}
            <Button disabled={!can} data-testid="button-publish-pricing" onClick={() => { setErr(null); pub.mutate({ expectedRevision: d.draftRevision, expectedPublishedRevision: d.publishedRevision, reason: reason.trim() }); }}>{pub.isPending ? 'Publishing...' : 'Publish pricing'}</Button>
          </div>
        </div>)}
    </Panel>
  );
}
