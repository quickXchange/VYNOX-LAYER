import { useEffect, useMemo, useState } from 'react';
import { useGatedMutate } from '@/components/super-admin/review-gate';
import {
  useGetTenantSubscription, getGetTenantSubscriptionQueryKey, useListPlans, useListAddons, useListEntitlementDefinitions,
  useChangeTenantPlan, useSetTenantAddons, useSetTenantOverrides, useSetTenantSuspension, useUpdateSubscriptionCommercial, type SubscriptionView,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useInvalidateTenant } from '@/lib/invalidate';
import { ErrorState } from './bits';
import { Section } from './sections';
import { OverridesEditor, overrideError } from './entitlement-editor';
import { SubscriptionTrial } from './subscription-trial';

export function useSubscription(tenantId: string) {
  return useGetTenantSubscription(tenantId, { query: { enabled: !!tenantId, queryKey: getGetTenantSubscriptionQueryKey(tenantId), staleTime: 10000, refetchInterval: 30000, refetchOnWindowFocus: true } });
}

export function hasFeature(sub: SubscriptionView | undefined, ...needles: string[]) {
  if (!sub) return false;
  return Object.entries(sub.features).some(([k, v]) => v && needles.some((n) => k.includes(n)));
}

function useDone(tenantId: string) {
  const inv = useInvalidateTenant();
  const { toast } = useToast();
  return {
    ok: (m: string) => { inv(tenantId); toast({ title: m }); },
    fail: (e: unknown) => toast({ title: 'Action failed', description: (e as Error)?.message ?? 'Request rejected', variant: 'destructive' }),
  };
}

function Capabilities({ sub }: { sub: SubscriptionView }) {
  const defs = useListEntitlementDefinitions();
  const lbl = (k: string) => defs.data?.find((d) => d.key === k)?.label ?? k;
  const feats = Object.entries(sub.features);
  const lims = Object.entries(sub.limits);
  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
        {[['Plan', sub.plan?.name ?? 'None assigned'], ['Subscription', sub.status], ['Limits', sub.overLimit ? 'over limit' : 'within limits']].map(([l, v]) => (
          <div key={l} className="bg-card p-4"><p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{l}</p><p data-testid={`text-sub-${l.toLowerCase()}`} className={`mt-1 text-sm capitalize ${v === 'over limit' ? 'text-destructive' : ''}`}>{v}</p></div>))}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div><p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Effective features</p>
          <div className="divide-y rounded-md border">{feats.length === 0 && <p className="p-3 text-sm text-muted-foreground">None.</p>}
            {feats.map(([k, v]) => <div key={k} className="flex items-center justify-between p-3 text-sm"><span>{lbl(k)}</span><span className="font-mono text-[10px] uppercase text-muted-foreground">{v ? 'on' : 'off'}{sub.sources[k] ? ` · ${sub.sources[k]}` : ''}</span></div>)}</div></div>
        <div><p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Usage against limits</p>
          <div className="divide-y rounded-md border">{sub.usage.length === 0 && lims.length === 0 && <p className="p-3 text-sm text-muted-foreground">No limits defined.</p>}
            {sub.usage.map((u) => (
              <div key={u.key} className="p-3" data-testid={`row-usage-${u.key}`}>
                <div className="flex items-center justify-between text-sm"><span>{u.label}</span><span className={`font-mono text-xs ${u.exceeded ? 'text-destructive' : ''}`}>{u.used} / {u.limit}</span></div>
                <div className="mt-2 h-1 rounded bg-muted"><div className={`h-1 rounded ${u.exceeded ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${Math.min(100, Number(u.limit) > 0 ? (Number(u.used) / Number(u.limit)) * 100 : u.exceeded ? 100 : 0)}%` }} /></div>
              </div>))}</div></div>
      </div>
    </div>
  );
}

function PlanPanel({ sub }: { sub: SubscriptionView }) {
  const plans = useListPlans();
  const m = useChangeTenantPlan();
  const gM = useGatedMutate(m.mutate, 'Change plan');
  const d = useDone(sub.tenantId);
  const [sel, setSel] = useState(sub.plan?.id ?? '');
  useEffect(() => setSel(sub.plan?.id ?? ''), [sub.plan?.id]);
  const opts = (plans.data ?? []).filter((p) => p.status === 'enabled' || p.id === sub.plan?.id).sort((a, b) => a.displayOrder - b.displayOrder);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-72"><p className="mb-1.5 text-sm">Plan</p>
        {plans.isLoading ? <Skeleton className="h-9" /> : plans.isError ? <button className="text-sm text-destructive underline" onClick={() => plans.refetch()}>Retry loading plans</button> : (
          <Select value={sel} onValueChange={setSel}><SelectTrigger data-testid="select-tenant-plan"><SelectValue placeholder="Select a plan" /></SelectTrigger>
            <SelectContent>{opts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.status !== 'enabled' ? ` (${p.status}, current)` : ''}</SelectItem>)}</SelectContent></Select>)}</div>
      <Button data-testid="button-change-plan" disabled={!sel || sel === sub.plan?.id || m.isPending} onClick={() => gM({ tenantId: sub.tenantId, data: { planId: sel } }, { onSuccess: () => d.ok('Plan changed'), onError: d.fail })}>{m.isPending ? 'Changing' : 'Change plan'}</Button>
    </div>
  );
}

function AddonsPanel({ sub }: { sub: SubscriptionView }) {
  const addons = useListAddons();
  const m = useSetTenantAddons();
  const gM = useGatedMutate(m.mutate, 'Save add-ons');
  const d = useDone(sub.tenantId);
  const cur = sub.addons.map((a) => a.id);
  const [sel, setSel] = useState<string[]>(cur);
  const key = cur.join(',');
  useEffect(() => setSel(cur), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (addons.data ?? []).filter((a) => a.enabled || cur.includes(a.id));
  if (addons.isLoading) return <Skeleton className="h-24" />;
  if (addons.isError) return <ErrorState what="add-ons" onRetry={() => addons.refetch()} />;
  return (
    <div className="space-y-3">
      {list.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No add-ons in the catalog.</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((a) => (
          <label key={a.id} className="flex cursor-pointer gap-3 rounded-md border p-3 hover:bg-muted/50">
            <Checkbox data-testid={`checkbox-addon-${a.id}`} checked={sel.includes(a.id)} onCheckedChange={() => setSel((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))} className="mt-0.5" />
            <span><span className="block text-sm font-medium">{a.name}</span><span className="block text-xs text-muted-foreground">{a.description}</span></span>
          </label>))}
      </div>
      <Button data-testid="button-save-addons" disabled={m.isPending} onClick={() => gM({ tenantId: sub.tenantId, data: { addonIds: sel } }, { onSuccess: () => d.ok('Add-ons saved'), onError: d.fail })}>{m.isPending ? 'Saving' : 'Save add-ons'}</Button>
    </div>
  );
}

function OverridesPanel({ sub }: { sub: SubscriptionView }) {
  const defs = useListEntitlementDefinitions();
  const m = useSetTenantOverrides();
  const gM = useGatedMutate(m.mutate, 'Save overrides');
  const d = useDone(sub.tenantId);
  const [rows, setRows] = useState(sub.overrides);
  useEffect(() => setRows(sub.overrides), [sub.overrides]);
  const defList = useMemo(() => defs.data ?? [], [defs.data]);
  const err = overrideError(defList, rows);
  if (defs.isLoading) return <Skeleton className="h-24" />;
  if (defs.isError) return <ErrorState what="definitions" onRetry={() => defs.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Overrides apply to this tenant only. A numeric override replaces the combined plan and add-on value.</p>
      <OverridesEditor defs={defList} rows={rows} onChange={setRows} />
      <div className="flex items-center gap-3">
        <Button data-testid="button-save-overrides" disabled={!!err || m.isPending} onClick={() => gM({ tenantId: sub.tenantId, data: { overrides: rows } }, { onSuccess: () => d.ok('Overrides saved'), onError: d.fail })}>{m.isPending ? 'Saving' : 'Save overrides'}</Button>
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </div>
  );
}

function CommercialPanel({ sub }: { sub: SubscriptionView }) {
  const m = useUpdateSubscriptionCommercial();
  const gM = useGatedMutate(m.mutate, 'Update commercial settings');
  const d = useDone(sub.tenantId);
  const [period, setPeriod] = useState<'monthly' | 'yearly'>(sub.billingPeriod ?? 'monthly');
  const [disc, setDisc] = useState(sub.discountPercent ?? '0');
  const [note, setNote] = useState(sub.operatorNote ?? '');
  const [reason, setReason] = useState('');
  const key = `${sub.tenantId}|${sub.billingPeriod}|${sub.discountPercent}|${sub.operatorNote}`;
  useEffect(() => { setPeriod(sub.billingPeriod ?? 'monthly'); setDisc(sub.discountPercent ?? '0'); setNote(sub.operatorNote ?? ''); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelled = sub.status === 'cancelled';
  const bad = !/^\d{1,3}(\.\d{1,2})?$/.test(disc) || Number(disc) > 100 ? 'Discount is a percentage from 0 to 100' : '';
  const send = (action: 'save' | 'cancel' | 'restore') => gM({ tenantId: sub.tenantId, data: { billingPeriod: action === 'save' ? period : (sub.billingPeriod ?? 'monthly'), discountPercent: action === 'save' ? disc : (sub.discountPercent ?? '0'), operatorNote: action === 'save' ? note : (sub.operatorNote ?? ''), action, reason: reason.trim() } },
    { onSuccess: () => { setReason(''); d.ok(action === 'save' ? 'Commercial settings saved' : action === 'cancel' ? 'Subscription cancelled' : 'Subscription restored'); }, onError: d.fail });
  const est = sub.recurringEstimate;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[180px_160px_1fr]">
        <div className="space-y-1.5"><p className="text-sm">Billing period</p>
          <Select value={period} onValueChange={(v) => { if (v === 'monthly' || v === 'yearly') setPeriod(v); }}><SelectTrigger data-testid="select-commercial-period"><SelectValue>{period === 'yearly' ? 'Yearly' : 'Monthly'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select></div>
        <div className="space-y-1.5"><label htmlFor="com-disc" className="text-sm">Discount %</label><Input id="com-disc" data-testid="input-commercial-discount" inputMode="decimal" aria-invalid={!!bad} value={disc} onChange={(e) => setDisc(e.target.value)} /></div>
        <div className="space-y-1.5"><label htmlFor="com-note" className="text-sm">Operator note</label><Textarea id="com-note" data-testid="input-commercial-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="text-recurring-estimate">
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Saved recurring estimate</p>
        <p className="mt-1">{est == null ? 'Unconfigured: one or more assigned items has no price (Requires review).' : `${sub.currency ?? ''} ${est} / ${sub.billingPeriod === 'yearly' ? 'year' : 'month'}`}</p>
        <p className="mt-1 text-xs text-muted-foreground">Save your settings to recalculate this estimate. Calculated from current catalog metadata with discounts on recurring prices only. It is not an invoice and does not replace an approved quotation. No payment is collected{sub.billingConnected === false ? '; billing is not connected' : ''}.</p></div>
      <div className="space-y-1.5">
        <label htmlFor="commercial-reason" className="text-sm">Change reason (required for save, cancel or restore)</label>
        <Input id="commercial-reason" data-testid="input-commercial-reason" className="max-w-md" minLength={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you making this change?" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="button-save-commercial" disabled={!!bad || reason.trim().length < 2 || m.isPending} onClick={() => send('save')}>{m.isPending ? 'Saving' : 'Save commercial settings'}</Button>
        {bad && <span role="alert" className="text-sm text-destructive">{bad}</span>}
      </div>
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm text-muted-foreground">{cancelled ? 'This subscription is cancelled. Records and configuration are retained but tenant access stays suspended until you restore it explicitly.' : 'Cancelling retains all records and configuration but suspends tenant access. Restore is a separate explicit action.'}</p>
        <div className="flex flex-wrap gap-2">
          <Button data-testid={cancelled ? 'button-restore-subscription' : 'button-cancel-subscription'} variant={cancelled ? 'outline' : 'destructive'} disabled={reason.trim().length < 2 || m.isPending} onClick={() => send(cancelled ? 'restore' : 'cancel')}>{cancelled ? 'Restore subscription' : 'Cancel subscription'}</Button></div>
      </div>
    </div>
  );
}

function ReadOnlySummary({ sub }: { sub: SubscriptionView }) {
  const per = sub.billingPeriod === 'yearly' ? 'year' : 'month';
  const rows: [string, string][] = [
    ['Plan', sub.plan?.name ?? 'None assigned'], ['Status', sub.status],
    ['Add-ons', sub.addons.length ? sub.addons.map((a) => a.name).join(', ') : 'None'],
    ['Billing period', sub.billingPeriod ?? 'monthly'], ['Recurring discount', `${sub.discountPercent ?? '0'}% (recurring prices only, never setup)`],
    ['Recurring estimate', sub.recurringEstimate == null ? 'Not configured' : `${sub.currency ?? ''} ${sub.recurringEstimate} / ${per}`],
  ];
  return (
    <div className="space-y-2" data-testid="summary-subscription-readonly">
      <dl className="divide-y rounded-md border text-sm">{rows.map(([k, v]) => <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-1 p-3"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 capitalize [overflow-wrap:anywhere]">{v}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Estimate from current catalog metadata. It is not an invoice, no payment is collected, and it does not replace an approved quotation.</p>
    </div>
  );
}

function SuspensionPanel({ sub }: { sub: SubscriptionView }) {
  const m = useSetTenantSuspension();
  const gM = useGatedMutate(m.mutate, 'Change suspension');
  const d = useDone(sub.tenantId);
  const [reason, setReason] = useState('');
  const cancelled = sub.status === 'cancelled';
  const suspended = sub.status === 'suspended' || sub.tenantStatus === 'suspended' || cancelled;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{cancelled ? 'The subscription is cancelled, so access is suspended. Unsuspending cannot bypass this: restore the subscription under Commercial settings.' : suspended ? 'This tenant is suspended: its public site is unavailable and its client admin is read-only. It cannot be activated until unsuspended.' : 'Suspending makes the tenant site unavailable and locks the client admin to read-only.'}</p>
      <div className="flex flex-wrap gap-2">
        <Input data-testid="input-suspend-reason" className="max-w-md" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button data-testid="button-suspend" variant={suspended ? 'outline' : 'destructive'} disabled={cancelled || reason.trim().length < 2 || m.isPending}
          onClick={() => gM({ tenantId: sub.tenantId, data: { suspended: !suspended, reason: reason.trim() } }, { onSuccess: () => { setReason(''); d.ok(suspended ? 'Tenant unsuspended' : 'Tenant suspended'); }, onError: d.fail })}>
          {m.isPending ? 'Working' : suspended ? 'Unsuspend' : 'Suspend tenant'}</Button>
      </div>
    </div>
  );
}

export function SubscriptionSections({ tenantId, canManage, show }: { tenantId: string; canManage: boolean; show?: ('capabilities' | 'plan' | 'addons' | 'overrides' | 'suspension' | 'commercial' | 'summary')[] }) {
  const on = (k: NonNullable<typeof show>[number]) => !show || show.includes(k);
  const q = useSubscription(tenantId);
  const sub = q.data;
  return (
    <div className="space-y-6">
      {sub && (on('commercial') || on('summary') || on('plan')) && <SubscriptionTrial key={tenantId} sub={sub} canManage={canManage} />}
      {on('capabilities') && <Section n="S1" title={canManage ? 'Subscription' : 'Your capabilities'} note="Effective rights resolved from plan, add-ons and tenant overrides." footer={<span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{canManage ? 'Operator controls below' : 'Managed by your platform operator'}</span>}>
        {q.isLoading ? <Skeleton className="h-48" /> : q.isError || !sub ? <ErrorState what="subscription" onRetry={() => q.refetch()} /> : <Capabilities sub={sub} />}
      </Section>}
      {!canManage && sub && on('summary') && <Section n="S2" title="Plan and pricing" note="Read-only. Changes are made by your platform operator." footer={<span />}><ReadOnlySummary sub={sub} /></Section>}
      {canManage && sub?.trial && <p className="text-sm text-muted-foreground">Trial terms are frozen. Use the trial controls above; plan, add-on and commercial changes cannot replace the agreement or bypass its deadline.</p>}
      {canManage && sub && !sub.trial && (
        <>
          {on('plan') && <Section n="S2" title="Plan" note="Disabled or archived plans cannot be newly assigned." footer={<span />}><PlanPanel sub={sub} /></Section>}
          {on('addons') && <Section n="S3" title="Add-ons" note="Feature grants combine with the plan; numeric increments add to it." footer={<span />}><AddonsPanel sub={sub} /></Section>}
          {on('overrides') && <Section n="S4" title="Overrides" note="Tenant-only feature and limit replacements, each with a reason." footer={<span />}><OverridesPanel sub={sub} /></Section>}
          {on('commercial') && <Section n="S6" title="Commercial settings" note="Billing period, recurring discount and cancellation. Metadata only; nothing is charged." footer={<span />}><CommercialPanel sub={sub} /></Section>}
          {on('suspension') && <Section n="S5" title="Suspension" note="Reason is recorded in activity." footer={<span />}><SuspensionPanel sub={sub} /></Section>}
        </>)}
    </div>
  );
}
