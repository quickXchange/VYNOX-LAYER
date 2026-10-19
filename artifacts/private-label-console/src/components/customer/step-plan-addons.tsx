import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState, ListSkeleton, EmptyState } from '@/components/app/bits';
import type { Catalog } from '@/lib/wl';
import { ACTS, type StepProps } from './configure-state';
import { FeatureRowList } from '@/components/commerce/feature-rows-editor';
import { readFeatureRows } from '@/lib/feature-rows';
import { Entitlements, PriceLine, planPeriods } from './plan-bits';

type Q = { data?: Catalog; isLoading: boolean; isError: boolean; refetch: () => unknown };

export function FeaturesStep({ cfg, set }: StepProps) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="sr-only">Exchange features</legend>
      {ACTS.map((x) => <label key={x} className="flex items-center gap-3 rounded-md border bg-card p-4 capitalize"><Checkbox data-testid={`check-${x}`} checked={cfg.acts.includes(x)} onCheckedChange={(v) => set((c) => ({ acts: v ? [...c.acts, x] : c.acts.filter((y) => y !== x) }))} />{x}</label>)}
    </fieldset>
  );
}

export function PlanStep({ cfg, set, cat }: StepProps & { cat: Q }) {
  if (cat.isLoading) return <ListSkeleton rows={3} />;
  if (cat.isError || !cat.data) return <ErrorState what="the plan catalog" onRetry={() => cat.refetch()} />;
  const { plans, definitions } = cat.data; const avail = planPeriods(plans.find((x) => x.id === cfg.planId));
  if (!plans.length) return <EmptyState title="No plans available" body="No Exchange plan is currently open for ordering." />;
  return (
    <div className="space-y-5">
      <div className="inline-flex gap-1 rounded-md border p-1 text-sm" role="group" aria-label="Billing period">
        {(['monthly', 'yearly'] as const).map((p) => <button type="button" key={p} data-testid={`period-${p}`} aria-pressed={cfg.period === p} disabled={!avail.includes(p)} title={avail.includes(p) ? undefined : 'Not available for this plan'} onClick={() => set({ period: p })} className={`rounded px-4 py-1 capitalize ${cfg.period === p ? 'bg-primary text-primary-foreground' : ''} disabled:cursor-not-allowed disabled:opacity-40`}>{p}</button>)}
      </div>
      <div role="radiogroup" aria-label="Plan" className="grid gap-3 md:grid-cols-2">
        {plans.map((p) => (
          <button type="button" role="radio" aria-checked={cfg.planId === p.id} key={p.id} data-testid={`plan-${p.id}`} onClick={() => set((c) => ({ planId: p.id, addonIds: p.id === c.planId ? c.addonIds : [] }))} className={`rounded-md border p-4 text-left transition-colors ${cfg.planId === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card hover:bg-muted/50'}`}>
            <p className="font-display text-2xl">{p.name}</p>
            <PriceLine x={p} period={cfg.period} />
            {p.billingLabel && <p className="text-xs text-muted-foreground">{p.billingLabel}</p>}
            {p.description && <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>}
            <FeatureRowList rows={readFeatureRows(p)} testid={`list-plan-features-${p.id}`} />
            <Entitlements items={p.entitlements} defs={definitions} />
          </button>))}
      </div>
    </div>
  );
}

export function AddonsStep({ cfg, set, cat }: StepProps & { cat: Q }) {
  if (cat.isLoading) return <ListSkeleton rows={3} />;
  if (cat.isError || !cat.data) return <ErrorState what="the add-on catalog" onRetry={() => cat.refetch()} />;
  const plan = cat.data.plans.find((p) => p.id === cfg.planId);
  const list = cat.data.addons.filter((a) => !plan || !a.currency || a.currency === plan.currency);
  if (!list.length) return <EmptyState title="No add-ons for this plan" body="Nothing extra is available in the selected plan's currency. You can continue." />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {list.map((a) => (
        <label key={a.id} className={`flex cursor-pointer gap-3 rounded-md border p-4 ${cfg.addonIds.includes(a.id) ? 'border-primary bg-primary/5' : 'bg-card'}`}>
          <Checkbox data-testid={`addon-${a.id}`} className="mt-1" checked={cfg.addonIds.includes(a.id)} onCheckedChange={(v) => set((c) => ({ addonIds: v ? [...c.addonIds, a.id] : c.addonIds.filter((y) => y !== a.id) }))} />
          <span className="min-w-0"><span className="font-display block text-xl">{a.name}</span><PriceLine x={a} period={cfg.period} />{a.description && <span className="mt-1 block text-sm text-muted-foreground">{a.description}</span>}<Entitlements items={a.entitlements} defs={cat.data!.definitions} /></span>
        </label>))}
    </div>
  );
}
