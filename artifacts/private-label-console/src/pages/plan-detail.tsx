import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useListPlans, useGetPlan, getGetPlanQueryKey, useCreatePlan, useUpdatePlan, useDeletePlan, getListPlansQueryKey, useListEntitlementDefinitions, type PlanInput } from '@workspace/api-client-react';
import { ArrowLeft } from 'lucide-react';
import { PageHeader, ErrorState, ListSkeleton } from '@/components/app/bits';
import { GroupedEntitlementEditor } from '@/components/super-admin/grouped-entitlements';
import { ReviewDialog } from '@/components/super-admin/kit';
import { entriesFrom, entError, toMap, type EntMap } from '@/components/app/entitlement-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { discounted } from '@/lib/wl';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCan } from '@/lib/principal';
import { useInvalidateCatalog } from '@/lib/invalidate';
import { PeriodsEditor } from '@/components/commerce/periods-editor';
import { useToast } from '@/hooks/use-toast';
import { FeatureRowsEditor } from '@/components/commerce/feature-rows-editor';
import { cleanFeatureRows, featureRowsError, readFeatureRows, type FeatureRow } from '@/lib/feature-rows';
import { ProfileEditor } from '@/components/plan-management/profile-editor';
import { PlanCard } from '@/components/plan-management/plan-card-preview';
import { PlanHistory } from '@/components/plan-management/plan-history';
import { MigrationPanel } from '@/components/plan-management/migration-panel';
import { usePlanPeriods } from '@/components/plan-management/use-periods';
import { blankProfile, profileError, type PlanProfile } from '@/components/plan-management/types';

const MONEY = /^[0-9]+(?:\.[0-9]{1,2})?$/;
const blank = { name: '', description: '', monthlyPrice: '', yearlyPrice: '', setupFee: '', discountPercent: '0', currency: 'EUR', billingLabel: '', displayOrder: '0', status: 'disabled' as PlanInput['status'] };

export default function PlanDetail() {
  const params = useParams<{ id?: string }>();
  const id = params.id && params.id !== 'new' ? params.id : '';
  const can = useCan();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const inv = useInvalidateCatalog();
  const defs = useListEntitlementDefinitions();
  const plan = useGetPlan(id, { query: { enabled: !!id, queryKey: getGetPlanQueryKey(id) } });
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const del = useDeletePlan();
  const [configured, setConfigured] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [f, setF] = useState(blank);
  const [ent, setEnt] = useState<EntMap>({});
  const [rev, setRev] = useState(false);
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [profile, setProfile] = useState<PlanProfile>(blankProfile);
  const [revision, setRevision] = useState<number | undefined>(undefined);
  const all = useListPlans();
  const periods = usePlanPeriods(id);
  const init = useRef('');
  useEffect(() => {
    if (plan.data && init.current !== plan.data.id) {
      init.current = plan.data.id; const p = plan.data;
      setF({ name: p.name, description: p.description, monthlyPrice: p.monthlyPrice ?? '', yearlyPrice: p.yearlyPrice ?? '', setupFee: p.setupFee ?? '', discountPercent: p.discountPercent ?? '0', currency: p.currency, billingLabel: p.billingLabel, displayOrder: String(p.displayOrder), status: p.status });
      setConfigured(p.pricingConfigured ?? (p.monthlyPrice != null && p.yearlyPrice != null && p.setupFee != null));
      setEnt(toMap(p.entitlements));
      setRows(readFeatureRows(p));
      setProfile({ ...blankProfile(), ...(p.profile ?? {}) }); setRevision(p.revision);
    }
  }, [plan.data]);
  if (!can.manageCatalog) return <p className="text-sm text-muted-foreground">Only a super admin can manage plans.</p>;
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  // Historical entitlements remain stored, but retired products cannot be
  // selected as active plan features for new Exchange deliveries.
  const d = (defs.data ?? []).filter(x=>!["buy","sell"].includes(x.key));
  const order = Number(f.displayOrder);
  const err = f.name.trim().length < 2 ? 'Name needs 2+ characters' : configured && ![f.monthlyPrice, f.yearlyPrice, f.setupFee].every((x) => MONEY.test(x)) ? 'Configured pricing needs monthly, yearly and setup as decimals with up to 2 places'
    : !/^\d{1,3}(\.\d{1,2})?$/.test(f.discountPercent) || Number(f.discountPercent) > 100 ? 'Discount is a percentage from 0 to 100'
    : !/^[A-Z]{3}$/.test(f.currency) ? 'Currency is a 3-letter uppercase code' : !Number.isInteger(order) || order < 0 || order > 100000 ? 'Display order 0 - 100000' : featureRowsError(rows) || profileError(profile, { configured, monthly: f.monthlyPrice, yearly: f.yearlyPrice, discount: f.discountPercent }, id ? periods.data : undefined) || entError(d, ent);
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!err) setRev(true); };
  const doSave = () => {
    const data: PlanInput = { name: f.name.trim(), description: f.description, monthlyPrice: configured ? f.monthlyPrice : null, yearlyPrice: configured ? f.yearlyPrice : null, setupFee: configured ? f.setupFee : null, discountPercent: f.discountPercent, currency: f.currency, billingLabel: f.billingLabel, displayOrder: order, status: f.status, entitlements: entriesFrom(d, ent, true), featureRows: cleanFeatureRows(rows),
      profile: { ...profile, slug: profile.slug || undefined, ctaUrl: profile.ctaUrl || undefined, requestedProviders: (profile.requestedProviders ?? []).map((x) => x.trim()).filter(Boolean) }, expectedRevision: revision } as PlanInput;
    const fail = (er: unknown) => { setRev(false); toast({ title: 'Save failed', description: (er as Error).message, variant: 'destructive' }); };
    if (id) update.mutate({ planId: id, data }, { onSuccess: (p) => { setRev(false); setRevision(p.revision); qc.setQueryData(getGetPlanQueryKey(id), p); inv(); toast({ title: 'Draft saved', description: 'Publish from Subscription Plans to show it to customers.' }); }, onError: fail });
    else create.mutate({ data }, { onSuccess: (p) => { setRev(false); inv(); toast({ title: 'Plan created' }); nav(`/plans/${p.id}`); }, onError: fail });
  };
  const loading = defs.isLoading || (!!id && plan.isLoading);
  return (
    <>
      <Link href="/plans" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Plans</Link>
      <PageHeader eyebrow={id ? 'Edit plan' : 'New plan'} title={id ? (plan.data?.name ?? 'Plan') : 'New plan'} />
      {loading ? <ListSkeleton /> : defs.isError ? <ErrorState what="entitlement definitions" onRetry={() => defs.refetch()} /> : id && (plan.isError || !plan.data) ? <ErrorState what="this plan" onRetry={() => plan.refetch()} /> : (
        <form onSubmit={submit} className="space-y-6">
          <section className="space-y-4 rounded-md border bg-card p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5"><Label>Name</Label><Input data-testid="input-plan-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Billing label</Label><Input data-testid="input-plan-billing" value={f.billingLabel} onChange={(e) => set('billingLabel', e.target.value)} /></div>
              <div className="space-y-1.5 md:col-span-2"><Label>Description</Label><Textarea data-testid="input-plan-description" value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
              <div className="flex items-center gap-3 md:col-span-2"><Switch id="plan-configured" data-testid="switch-plan-configured" checked={configured} onCheckedChange={setConfigured} /><Label htmlFor="plan-configured">Pricing configured</Label><span className="text-xs text-muted-foreground">{configured ? 'Monthly, yearly and setup are all required.' : 'Off: all three prices are saved as unconfigured and customers see Requires review.'}</span></div>
              {([['monthlyPrice', 'Monthly price'], ['yearlyPrice', 'Yearly price'], ['setupFee', 'Setup fee']] as const).map(([k, l]) => (
                <div key={k} className="space-y-1.5"><Label htmlFor={`plan-${k}`}>{l}</Label><Input id={`plan-${k}`} data-testid={`input-plan-${k}`} className="font-mono" disabled={!configured} placeholder={configured ? '0.00' : 'Not configured'} aria-invalid={configured && !MONEY.test(f[k])} value={f[k]} onChange={(e) => set(k, e.target.value)} /></div>))}
              <div className="space-y-1.5"><Label htmlFor="plan-discount">Discount percent (recurring only)</Label><Input id="plan-discount" data-testid="input-plan-discount" className="font-mono" inputMode="decimal" value={f.discountPercent} onChange={(e) => set('discountPercent', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Currency</Label><Input data-testid="input-plan-currency" readOnly={!id} className="font-mono" value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></div>
              <div className="space-y-1.5"><Label>Display order</Label><Input data-testid="input-plan-order" className="font-mono" value={f.displayOrder} onChange={(e) => set('displayOrder', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Status</Label>
                <Select value={f.status} onValueChange={(v) => { if (['enabled', 'disabled', 'archived'].includes(v)) set('status', v); }}><SelectTrigger data-testid="select-plan-status"><SelectValue>{f.status.charAt(0).toUpperCase() + f.status.slice(1)}</SelectValue></SelectTrigger>
                  <SelectContent>{['enabled', 'disabled', 'archived'].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Prices are stored for reference only. No billing is performed. Discounts apply to monthly and yearly prices, never to the setup fee.{configured && MONEY.test(f.monthlyPrice) && MONEY.test(f.yearlyPrice) && !err.startsWith('Discount') ? ` After discount: ${discounted(f.monthlyPrice, f.discountPercent)} / mo, ${discounted(f.yearlyPrice, f.discountPercent)} / yr ${f.currency}.` : ''}</p>
          </section>
          <section className="space-y-3 rounded-md border bg-card p-5" aria-labelledby="plan-profile-h">
            <h2 id="plan-profile-h" className="font-display text-2xl">Plan configuration</h2>
            <ProfileEditor value={profile} onChange={setProfile} />
          </section>
          <section className="space-y-3 rounded-md border bg-card p-5" aria-labelledby="plan-preview-h">
            <h2 id="plan-preview-h" className="font-display text-2xl">Customer preview</h2>
            <p className="text-xs text-muted-foreground">Rendered from this unsaved draft with the same card the public pricing page uses. Internal notes are never shown.</p>
            <div className="max-w-sm"><PlanCard plan={{ id: id || 'draft', name: f.name || 'Untitled plan', description: f.description, monthlyPrice: configured ? f.monthlyPrice : null, yearlyPrice: configured ? f.yearlyPrice : null, setupFee: configured ? f.setupFee : null, currency: f.currency, discountPercent: f.discountPercent, pricingConfigured: configured, featureRows: rows, profile }} /></div>
          </section>
          <section className="space-y-3 rounded-md border bg-card p-5" aria-labelledby="plan-feature-rows-h">
            <h2 id="plan-feature-rows-h" className="font-display text-2xl">Customer-visible features</h2>
            <FeatureRowsEditor value={rows} onChange={setRows} />
          </section>
          <section className="space-y-3 rounded-md border bg-card p-5">
            <h2 className="font-display text-2xl">Entitlements</h2>
            <GroupedEntitlementEditor defs={d} value={ent} onChange={setEnt} />
          </section>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {err && <span role="alert" className="mr-auto text-sm text-destructive">{err}</span>}
            {id && <Button type="button" variant="outline" className="text-destructive" data-testid="button-delete-plan" onClick={() => { setDelErr(null); setDelOpen(true); }}>Delete plan</Button>}
            <Button type="submit" data-testid="button-save-plan" disabled={!!err || create.isPending || update.isPending}>{create.isPending || update.isPending ? 'Saving' : id ? 'Save draft' : 'Create draft plan'}</Button>
          </div>
        </form>)}
      {id && plan.data && <div className="mt-6 max-w-3xl"><PeriodsEditor planId={id} plan={plan.data} /></div>}
      {id && plan.data && <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0"><MigrationPanel plan={plan.data} plans={all.data ?? []} /><PlanHistory planId={id} /></div>}
      <ReviewDialog open={delOpen} onClose={() => setDelOpen(false)} title="delete plan" destructive applyLabel="Delete plan" pending={del.isPending} error={delErr}
        onApply={() => del.mutate({ planId: id, params: { expectedRevision: revision ?? 0 } }, { onSuccess: () => { setDelOpen(false); qc.removeQueries({ queryKey: getGetPlanQueryKey(id) }); qc.invalidateQueries({ queryKey: getListPlansQueryKey() }); inv(); toast({ title: 'Plan deleted' }); nav('/plans'); }, onError: (e) => setDelErr(`${(e as Error).message}. A plan assigned to a project or referenced by an order cannot be deleted; disable or archive it to stop new offers.`) })}
        rows={[['Plan', f.name], ['Rule', 'Refused if assigned to any project or referenced by any order'], ['Alternative', 'Disable or archive to stop offering it']]} />
      <ReviewDialog open={rev} onClose={() => setRev(false)} title={id ? 'save plan' : 'create plan'} pending={create.isPending || update.isPending} onApply={doSave}
        rows={[['Name', f.name.trim()], ['Status', f.status], ['Prices', configured ? `${f.monthlyPrice} / mo, ${f.yearlyPrice} / yr, ${f.setupFee} setup ${f.currency}` : 'Unconfigured (Requires review)'], ['Discount (recurring only)', `${f.discountPercent}%`], ['Current subscribers', 'Unchanged: frozen contracts; move them explicitly below'], ['Customers see it', 'Only after the next publication'], ['Slug / tagline', `${profile.slug || '-'} / ${profile.tagline || '-'}`], ['Entitlements set', String(entriesFrom(d, ent, true).length)], ['Descriptive feature rows', rows.length ? `${rows.length} (descriptive only, public after next publication)` : 'None']]} />
    </>
  );
}
