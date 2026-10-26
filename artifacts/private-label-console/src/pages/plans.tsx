import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useListPlans, useListEntitlementDefinitions, useDuplicatePlan, useSetPlanStatus, type Plan } from '@workspace/api-client-react';
import { PageHeader, ErrorState, ListSkeleton } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Chips, DataList, Pager, Pill, ReviewDialog, SearchBox, usePaged, type Col } from '@/components/super-admin/kit';
import { usePlatform, unassignedProjects, usage } from '@/components/super-admin/platform';
import { useCan } from '@/lib/principal';
import { useInvalidateCatalog } from '@/lib/invalidate';
import { PricingPublicationPanel } from '@/components/commerce/pricing-publication-panel';
import { MethodsPanel } from '@/components/commerce/methods-panel';
import { ProposalsPanel } from '@/components/commerce/proposals-panel';
import { EmailsPanel } from '@/components/commerce/emails-panel';
import { useToast } from '@/hooks/use-toast';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { VersionsPanel } from '@/components/plan-management/versions-panel';
import { usePmMutations } from '@/components/plan-management/api';

export const planTone = (s: string) => (s === 'enabled' ? 'bg-primary text-primary-foreground' : s === 'archived' ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground');
type Pending = { plan: Plan; kind: 'duplicate' | 'enabled' | 'disabled' | 'archived' };

export default function Plans() {
  const can = useCan(); const q = useListPlans(); const defs = useListEntitlementDefinitions(); const { pm } = usePlatform();
  const dup = useDuplicatePlan(); const st = useSetPlanStatus(); const inv = useInvalidateCatalog(); const { toast } = useToast(); const [, nav] = useLocation();
  const { reorder } = usePmMutations();
  const [s, setS] = useState(''); const [f, setF] = useState('all'); const [pend, setPend] = useState<Pending | null>(null); const [err, setErr] = useState<string | null>(null);
  const all = useMemo(() => [...(q.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder), [q.data]);
  const list = useMemo(() => { const k = s.trim().toLowerCase(); return all.filter((p) => (f === 'all' || p.status === f) && (!k || [p.name, p.description, p.billingLabel, p.currency, p.profile?.slug ?? '', p.profile?.tagline ?? ''].some((v) => v.toLowerCase().includes(k)))); }, [all, s, f]);
  const pg = usePaged(list, `${s}|${f}`);
  if (!can.manageCatalog) return <><PageHeader eyebrow="Commercial" title="Subscription Plans Management" /><p className="text-sm text-muted-foreground" data-testid="text-forbidden">Only a super admin can manage plans.</p></>;
  const limitKeys = new Set((defs.data ?? []).filter((d) => d.kind === 'limit').map((d) => d.key));
  const apply = () => {
    if (!pend) return; setErr(null);
    const fail = (e: unknown) => setErr((e as Error).message);
    if (pend.kind === 'duplicate') dup.mutate({ planId: pend.plan.id }, { onSuccess: (n) => { inv(); setPend(null); toast({ title: 'Plan duplicated' }); nav(`/plans/${n.id}`); }, onError: fail });
    else st.mutate({ planId: pend.plan.id, data: { status: pend.kind, expectedRevision: pend.plan.revision ?? 0 } }, { onSuccess: () => { inv(); setPend(null); toast({ title: `Plan ${pend.kind}` }); }, onError: fail });
  };
  const btn = (p: Plan, kind: Pending['kind'], label: string, v: 'outline' | 'ghost' = 'outline') => <Button size="sm" variant={v} data-testid={`button-${kind}-${p.id}`} onClick={() => { setErr(null); setPend({ plan: p, kind }); }}>{label}</Button>;
  const move = (p: Plan, d: number) => { const ids = all.map((x) => x.id); const i = ids.indexOf(p.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate({ data: { plans: ids.map((x) => ({ id: x, revision: all.find((y) => y.id === x)?.revision ?? 0 })) } }, { onSuccess: () => { inv(); toast({ title: 'Order saved as draft' }); }, onError: (e) => toast({ title: 'Reorder failed', description: (e as Error).message, variant: 'destructive' }) }); };
  const cols: Col<Plan>[] = [
    { key: 'o', header: 'Order', cell: (p) => <span className="flex" onClick={(e) => e.stopPropagation()}><Button size="icon" variant="ghost" aria-label="Move up" disabled={reorder.isPending || all[0]?.id === p.id} onClick={() => move(p, -1)} data-testid={`button-up-${p.id}`}><ArrowUp className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Move down" disabled={reorder.isPending || all[all.length - 1]?.id === p.id} onClick={() => move(p, 1)} data-testid={`button-down-${p.id}`}><ArrowDown className="h-4 w-4" /></Button></span> },
    { key: 'n', header: 'Plan', primary: true, cell: (p) => <span><Link href={`/plans/${p.id}`} className="font-display text-xl hover:underline" data-testid={`link-plan-${p.id}`}>{p.name}</Link><span className="block font-mono text-[10px] uppercase tracking-wider text-copper">{p.profile?.slug ? `/${p.profile.slug}` : 'no slug'}{p.profile?.tagline ? ` / ${p.profile.tagline}` : ''}</span><span className="block max-w-xs truncate text-xs text-muted-foreground">{p.description || 'No description'}</span></span> },
    { key: 's', header: 'Status', cell: (p) => <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase ${planTone(p.status)}`}>{p.status}</span> },
    { key: 'pr', header: 'Prices', cell: (p) => <span className="font-mono text-xs">{p.profile?.pricingMode === 'contact_sales' ? (p.profile.contactSalesLabel || 'Contact sales') : p.pricingConfigured === false || p.monthlyPrice == null ? 'Unconfigured' : <>{p.monthlyPrice} / mo<br />{p.yearlyPrice ?? '-'} / yr<br />{p.setupFee ?? '-'} setup {p.currency}{p.discountPercent && Number(p.discountPercent) > 0 ? <><br />{p.discountPercent}% off recurring</> : null}</>}</span> },
    { key: 'b', header: 'Billing', cell: (p) => p.billingLabel || 'No label' },
    { key: 'f', header: 'Features / limits', cell: (p) => `${p.entitlements.filter((e) => !limitKeys.has(e.key) && e.value === true).length} / ${p.entitlements.filter((e) => limitKeys.has(e.key)).length}` },
    { key: 'u', header: 'Used by', cell: (p) => { if (!pm) return 'Unavailable'; const u = usage(pm.projects, (x) => x.planId === p.id); return `${u.customers} customers, ${u.tenants} projects`; } },
    { key: 'a', header: 'Actions', cell: (p) => <span className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="outline" onClick={() => nav(`/plans/${p.id}`)} data-testid={`button-edit-${p.id}`}>Edit</Button>{btn(p, 'duplicate', 'Duplicate')}
      {p.status !== 'enabled' && btn(p, 'enabled', 'Enable')}{p.status === 'enabled' && btn(p, 'disabled', 'Disable')}{p.status !== 'archived' && btn(p, 'archived', 'Archive', 'ghost')}</span> },
  ];
  return (
    <>
      <PageHeader eyebrow="Commercial" title="Subscription Plans Management"><Button asChild data-testid="button-new-plan"><Link href="/plans/new">New plan</Link></Button></PageHeader>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">Edits save as drafts. Customers see changes only after you publish below, and existing subscribers keep their frozen contracts until you explicitly move them from a plan's page. Blank prices mean pricing is not configured and customers see Requires review.</p>
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState what="plans" onRetry={() => q.refetch()} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3"><SearchBox id="plans" value={s} onChange={setS} placeholder="Search plans" />
            {pm ? <Pill tone="warn">{unassignedProjects(pm.projects)} projects without a plan</Pill> : <Pill>Usage unavailable</Pill>}</div>
          <Chips id="plans" value={f} onChange={setF} options={[['all', `All (${all.length})`], ...['enabled', 'disabled', 'archived'].map((x): [string, string] => [x, `${x} (${all.filter((p) => p.status === x).length})`])]} />
          <DataList id="plan" rows={pg.rows} cols={cols} rowKey={(p) => p.id} emptyTitle="No plans" emptyBody="Create a plan to start provisioning clients." />
          {list.length > 0 && <Pager id="plans" p={pg} />}
        </div>)}
      <div className="mt-8"><PricingPublicationPanel /></div>
      <div className="mt-4"><VersionsPanel /></div>
      <div className="mt-8 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0"><MethodsPanel /><EmailsPanel /></div>
      <div className="mt-4"><ProposalsPanel /></div>
      <ReviewDialog open={!!pend} onClose={() => setPend(null)} title={pend ? `${pend.kind === 'duplicate' ? 'duplicate' : pend.kind} plan` : ''} pending={dup.isPending || st.isPending} error={err} destructive={pend?.kind === 'archived'} onApply={apply}
        rows={pend ? [['Plan', pend.plan.name], ['Change', pend.kind === 'duplicate' ? 'Create a copy as a new plan' : `${pend.plan.status} to ${pend.kind}`], ['Existing subscribers', pend.kind === 'duplicate' ? 'Unaffected by the copy' : 'Keep their frozen contract; new assignment is blocked unless enabled'], ['Public pricing', 'Changes only after the next publication']] : []} />
    </>
  );
}
