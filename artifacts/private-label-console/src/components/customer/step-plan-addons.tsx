import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState, ListSkeleton, EmptyState } from '@/components/app/bits';
import type { Catalog } from '@/lib/wl';
import { CONVERT_PROVIDERS, type StepProps } from './configure-state';
import { FeatureRowList } from '@/components/commerce/feature-rows-editor';
import { readFeatureRows } from '@/lib/feature-rows';
import { Entitlements, PriceLine, planPeriods } from './plan-bits';

type Q = { data?: Catalog; isLoading: boolean; isError: boolean; refetch: () => unknown };

export function FeaturesStep({ cfg, set }: StepProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Choose one or both services for your white-label exchange.</p>
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="sr-only">Exchange features</legend>
        {[
          { id: 'swap', title: 'Swap', description: 'Let your customers exchange crypto for fiat currency, or fiat for crypto, using the payment methods configured for your exchange.' },
          { id: 'convert', title: 'Convert', description: 'Offer automated crypto-to-crypto exchanges through your chosen provider, once the service is connected and approved.' },
        ].map(x => <label key={x.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${cfg.acts.includes(x.id) ? 'border-primary bg-primary/5' : 'bg-card'}`}>
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" data-testid={`check-${x.id}`} checked={cfg.acts.includes(x.id)} onChange={e => { const checked = e.target.checked; set(c => ({ acts: checked ? [...new Set([...c.acts, x.id])] : c.acts.filter(y => y !== x.id) })); }} />
          <span><span className="block font-medium">{x.title}</span><span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{x.description}</span></span>
        </label>)}
      </fieldset>
      {cfg.acts.includes('convert') && <fieldset className="space-y-3 rounded-md border bg-card p-4">
        <legend className="px-1 text-sm font-medium">Convert providers</legend>
        <p className="text-sm text-muted-foreground">Choose Quickex, ChangeNOW, or both. Select at least one.</p>
        <div className="grid gap-3 sm:grid-cols-2">{CONVERT_PROVIDERS.map(p => <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3">
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" data-testid={`check-provider-${p.id}`} checked={cfg.convertProviders?.includes(p.id) ?? false} onChange={e => { const checked = e.target.checked; set(c => ({ convertProviders: checked ? [...new Set([...(c.convertProviders ?? []), p.id])] : (c.convertProviders ?? []).filter(id => id !== p.id) })); }} />
          <span className="text-sm font-medium">{p.label}</span>
        </label>)}</div>
        <p className="text-xs text-muted-foreground">These preferences are included in your request for operator review. Availability, connection setup and any provider fees must be confirmed. Selecting both does not enable automatic routing or activate trading.</p>
      </fieldset>}
    </div>
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
