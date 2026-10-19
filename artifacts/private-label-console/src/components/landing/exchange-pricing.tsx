import { Link } from 'wouter';
import { readFeatureRows } from '@/lib/feature-rows';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check } from 'lucide-react';
import { PUBLISHED_PLANS_KEY } from './published-plans';
import { VxCard } from './vx-ui';
import { recurringDisplayPrice } from '@/lib/commercial-price';

type Ent = { key: string; value: boolean | string };
type Plan = { id: string; name: string; description?: string; monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; currency: string; discountPercent?: string | null; billingPeriods?: string[]; entitlements?: Ent[]; pricingConfigured?: boolean; status?: string };
const money = (v: string, c: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(Number(v)); } catch { return `${v} ${c}`; } };
const label = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
const tierFeats = (e?: Ent[]) => (e ?? []).filter((x) => x.value === true || (typeof x.value === 'string' && x.value !== '' && x.value !== 'false'));

export function ExchangePricing({ tiers }: { tiers?: { label: string; planId: string | null }[] }) {
  const pub = useQuery({ queryKey: PUBLISHED_PLANS_KEY, staleTime: 5000, refetchInterval: 10000, refetchOnWindowFocus: true, queryFn: async () => { const r = await fetch(`${import.meta.env.BASE_URL}api/phase1/catalog`); if (!r.ok) throw new Error('Could not load published plans.'); return await r.json() as { plans: Plan[]; addons: Plan[]; methods: { currency: string }[]; purchaseAvailable: boolean }; } });
  const publishedPlans = pub.data?.plans ?? [];
  const hasPublished = publishedPlans.length > 0;
  const prop = useQuery({
    queryKey: ['public', 'plan-proposals'], enabled: pub.isSuccess && !hasPublished, staleTime: 5000, refetchInterval: 10000, refetchOnWindowFocus: true, retry: false,
    queryFn: async () => { const r = await fetch(`${import.meta.env.BASE_URL}api/public/plan-proposals`); if (!r.ok) throw new Error('proposals'); return await r.json() as { plans: Plan[] }; },
  });
  const loading = pub.isLoading || (pub.isSuccess && !hasPublished && prop.isLoading);
  // Published snapshot always wins; proposals are never shown once a publication exists.
  const referenced = (tiers ?? []).flatMap(t => {
    const p = publishedPlans.find(p => p.id === t.planId);
    return p ? [{ ...p, name: t.label }] : [];
  });
  const orderedPublished = [...referenced, ...publishedPlans.filter(p => !referenced.some(t => t.id === p.id))];
  const readFailed = pub.isError || (!hasPublished && prop.isError);
  const plans = readFailed ? [] : (hasPublished ? orderedPublished : (prop.data?.plans ?? []));
  const proposal = !hasPublished;
  const purchasable = hasPublished && pub.data?.purchaseAvailable === true;
  const shown = plans.slice(0, 3);
  const cards: (Plan | null)[] = shown.length ? shown : (loading ? [] : ['Basic', 'Premium', 'Pro'].map(() => null));
  const names = ['Basic', 'Premium', 'Pro'];
  return (
    <section id="pricing" className="vx-sec" aria-labelledby="vx-pricing-h" data-testid="section-exchange-pricing">
      <div className="s-wrap">
        <p className="s-eyebrow">Exchange plans</p>
        <h2 id="vx-pricing-h" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Choose your Exchange plan</h2>
        <p className="s-muted mt-2 max-w-2xl text-sm">{proposal ? 'Proposed tiers only. They cannot be purchased until the owner configures plans and a payment method and publishes them.' : 'Published plans, shown exactly as published. Ordering opens only when the platform reports purchasing as available.'}</p>
        {readFailed && <div role="alert" className="vx-card mt-4"><p>Could not load pricing. No fallback prices are shown.</p><button className="s-btn s-btn-ghost mt-2" onClick={() => { void pub.refetch(); if (!hasPublished) void prop.refetch(); }}>Retry pricing</button></div>}
        <div className="vx-tier mt-8" aria-live="polite">
          {loading && [0, 1, 2].map((i) => <div key={i} className="s-skel h-80" />)}
          {cards.map((p, i) => {
            const configured = !!p && p.pricingConfigured !== false && (p.monthlyPrice != null || p.yearlyPrice != null);
            const feats = tierFeats(p?.entitlements);
            const canOrder = !readFailed && purchasable && configured && !!p && (!p.billingPeriods || p.billingPeriods.length > 0) && (pub.data?.methods ?? []).some(m => m.currency === p.currency);
            return (
              <VxCard key={p?.id ?? i} className={`flex flex-col gap-4 ${i === 1 ? 'hot' : ''}`} testid={`card-exchange-tier-${p?.id ?? names[i]}`}>
                <div className="flex items-center justify-between gap-2"><h3 className="text-xl font-semibold">{p?.name ?? names[i]}</h3>{proposal && <span className="s-badge">Proposed</span>}</div>
                {p?.description && <p className="s-muted text-sm">{p.description}</p>}
                {readFeatureRows(p).length > 0 && <dl className="space-y-1 text-sm" data-testid={`list-tier-feature-rows-${p?.id}`}>{readFeatureRows(p).map((r, j) => <div key={j} className="flex justify-between gap-3"><dt className="s-muted">{r.label}</dt><dd className="text-right break-words">{r.value}</dd></div>)}</dl>}
                {(configured || proposal) && p && (p.monthlyPrice != null || p.yearlyPrice != null) ? (
                  <div data-testid={`text-tier-price-${p.id}`}>
                    {p.monthlyPrice != null && (!p.billingPeriods || p.billingPeriods.includes('monthly')) && <p className="text-3xl font-semibold tracking-tight">{money(recurringDisplayPrice(p.monthlyPrice, p.discountPercent ?? '0'), p.currency)}<span className="s-muted ml-1 text-xs font-normal">per month</span></p>}
                    {p.yearlyPrice != null && (!p.billingPeriods || p.billingPeriods.includes('yearly')) && <p className={p.monthlyPrice != null ? 's-muted text-sm' : 'text-3xl font-semibold tracking-tight'}>{money(recurringDisplayPrice(p.yearlyPrice, p.discountPercent ?? '0'), p.currency)} <span className="text-xs">per year</span></p>}
                    {Number(p.discountPercent ?? 0) > 0 && <p className="s-muted text-xs">Includes the published {p.discountPercent}% recurring discount</p>}
                    {p.setupFee != null && Number(p.setupFee) > 0 && <p className="s-muted text-xs">One-time setup {money(p.setupFee, p.currency)}</p>}
                  </div>
                ) : <p className="text-lg font-semibold" data-testid={`text-tier-unconfigured-${names[i]}`}>Pricing not configured yet</p>}
                {feats.length > 0 && <ul className="flex-1 space-y-1.5 text-sm">{feats.map((e) => <li key={e.key} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--s-accent-ink,var(--s-accent))' }} /><span>{label(e.key)}{e.value !== true && <span className="s-mono ml-1.5">{String(e.value)}</span>}</span></li>)}</ul>}
                {!feats.length && <div className="flex-1" />}
                {canOrder && p ? <Link href={`/account/configure?selectedPlanId=${encodeURIComponent(p.id)}`} onClick={() => { try { sessionStorage.setItem('vynox-intended-plan', p.id); } catch { /* storage optional */ } }} className="s-btn s-btn-primary justify-between" data-testid={`link-order-plan-${p.id}`}>Get Started<ArrowRight size={16} /></Link>
                  : proposal ? <Link href="/sign-up" className="s-btn s-btn-ghost justify-between" data-testid={`link-tier-account-${p?.id ?? names[i]}`}>Get Started<ArrowRight size={16} /></Link> : <button type="button" disabled className="s-btn s-btn-ghost justify-center opacity-70" data-testid={`button-tier-unavailable-${p?.id ?? names[i]}`}>Ordering unavailable</button>}
                {proposal && <p className="s-muted text-xs">Account creation only. This proposal cannot be purchased; planned modules are not operational.</p>}
              </VxCard>
            );
          })}
        </div>
        {!readFailed && (pub.data?.addons ?? []).length > 0 && <div className="mt-8"><h3 className="text-xl font-semibold">Optional add-ons</h3><div className="mt-4 grid gap-4 md:grid-cols-3">{pub.data!.addons.map(addon => <VxCard key={addon.id} className="space-y-3"><h4 className="font-semibold">{addon.name}</h4><p className="s-muted text-sm">{addon.description}</p>{addon.monthlyPrice != null && <p>{money(recurringDisplayPrice(addon.monthlyPrice, addon.discountPercent ?? '0'), addon.currency)} / month</p>}{addon.yearlyPrice != null && <p>{money(recurringDisplayPrice(addon.yearlyPrice, addon.discountPercent ?? '0'), addon.currency)} / year</p>}{addon.setupFee != null && Number(addon.setupFee) > 0 && <p className="s-muted text-xs">One-time setup {money(addon.setupFee, addon.currency)}</p>}<ul className="s-muted space-y-1 text-sm">{tierFeats(addon.entitlements).map(e => <li key={e.key}>{label(e.key)}{e.value !== true ? `: ${e.value}` : ''}</li>)}</ul><p className="s-muted text-xs">Selected in the existing Exchange request, subject to operator approval.</p></VxCard>)}</div></div>}
        {!loading && !shown.length && <p className="s-muted mt-4 text-xs" role="status">{pub.isError || prop.isError ? 'Pricing is unavailable. Retry above.' : 'No prices are published yet. Contact the operator for reviewed pricing.'}</p>}
      </div>
    </section>
  );
}
