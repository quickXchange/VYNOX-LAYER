import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { PlanCard } from '@/components/plan-management/plan-card-preview';
import type { PlanProfile } from '@/components/plan-management/types';
import { Section, SectionHead } from '@site/components/sections/common';

type Ent = { key: string; value: boolean | string };
type PPlan = { id: string; name: string; description?: string; monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; currency: string; discountPercent?: string | null; billingPeriods?: string[]; entitlements?: Ent[]; pricingConfigured?: boolean; profile?: Partial<PlanProfile> };
type PAddon = { id: string; name: string; description?: string; monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; currency: string; discountPercent?: string | null; entitlements?: Ent[] };
type Catalog = { plans: PPlan[]; addons: PAddon[]; methods: unknown[]; purchaseAvailable: boolean };
const LABELS: Record<string, string> = { crypto_exchange: 'Crypto exchange', swap: 'Swap', convert: 'Convert', telegram_bot: 'Telegram bot', telegram_mini_app: 'Telegram mini app', quickex: 'Quickex provider', whitebit: 'WhiteBIT provider', quickex_customer_credentials: 'Own Quickex credentials', whitebit_customer_credentials: 'Own WhiteBIT credentials', api_keys: 'API keys', website: 'Website', max_staff: 'Staff seats' };
import { readFeatureRows } from '@/lib/feature-rows';
export const PUBLISHED_PLANS_KEY = ['public', 'published-plans'];

const money = (v: string, cur: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(Number(v)); } catch { return `${v} ${cur}`; } };
const disc = (x: { discountPercent?: string | null }) => (Number(x.discountPercent) > 0 ? Number(x.discountPercent) : 0);

function Prices({ x, periods }: { x: PPlan | PAddon; periods?: string[] }) {
  const configured = (x as PPlan).pricingConfigured !== false && (x.monthlyPrice != null || x.yearlyPrice != null);
  if (!configured) return <p className="text-lg font-semibold" data-testid={`text-plan-price-${x.id}`}>Pricing on request</p>;
  const showM = x.monthlyPrice != null && (!periods || periods.length === 0 || periods.includes('monthly'));
  const showY = x.yearlyPrice != null && (!periods || periods.length === 0 || periods.includes('yearly'));
  return (
    <div data-testid={`text-plan-price-${x.id}`}>
      {showM && <p className="text-2xl font-semibold tracking-tight">{money(x.monthlyPrice!, x.currency)}<span className="s-muted ml-1 text-xs font-normal">per month</span></p>}
      {showY && <p className={showM ? 's-muted text-sm' : 'text-2xl font-semibold tracking-tight'}>{money(x.yearlyPrice!, x.currency)}<span className="s-muted ml-1 text-xs font-normal">per year</span></p>}
      {!showM && !showY && <p className="text-lg font-semibold">Pricing on request</p>}
      {x.setupFee != null && Number(x.setupFee) > 0 && <p className="s-muted text-xs">One-time setup fee {money(x.setupFee, x.currency)}</p>}
      {disc(x) > 0 && <p className="s-muted text-xs">{disc(x)}% off recurring prices</p>}
    </div>
  );
}

export function PublishedPlans() {
  const q = useQuery({
    queryKey: PUBLISHED_PLANS_KEY, staleTime: 20000, refetchOnWindowFocus: true, refetchInterval: 60000,
    queryFn: async () => { const r = await fetch(`${import.meta.env.BASE_URL}api/phase1/catalog`); if (!r.ok) throw new Error('catalog'); return await r.json() as Catalog; },
  });
  const label = (k: string) => LABELS[k] ?? (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
  const isLimit = (k: string) => /^max_|_limit$|_count$/.test(k) || typeof (plans.flatMap((p) => p.entitlements ?? []).find((e) => e.key === k)?.value) === 'string';
  const feats = (e?: Ent[]) => (e ?? []).filter((x) => x.value === true || (isLimit(x.key) && x.value !== false && x.value !== ''));
  const plans = q.data?.plans ?? []; const addons = (q.data?.addons ?? []).filter((a) => a.monthlyPrice != null || a.yearlyPrice != null || a.setupFee != null);
  return (
    <Section id="plans">
      <SectionHead eyebrow="Published plans" title="Plans and what each includes" body="Shown exactly as published. Prices and features appear here only after an explicit publication. Informational only; no checkout is available from this page." />
      <div className="mt-6" aria-live="polite">
        {q.isLoading ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="s-card h-72 animate-pulse" />)}</div>
          : q.isError ? <div className="s-card p-8 text-center" role="alert"><p className="font-semibold">Plans could not be loaded</p><button type="button" className="s-muted mt-2 text-sm underline" onClick={() => q.refetch()} data-testid="button-retry-plans">Try again</button></div>
          : plans.length === 0 ? <div className="s-card p-8 text-center" data-testid="empty-plans"><p className="text-xl font-semibold">Pricing on request</p><p className="s-muted mt-1 text-sm">No plans are published right now.</p></div>
          : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="list-published-plans">
            {plans.map((p) => p.profile && Object.keys(p.profile).length > 0 ? (
              <PlanCard key={p.id} plan={p} cta={(href, l) => <Link href={href} className="inline-flex w-full justify-center rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90" data-testid={`link-plan-cta-${p.id}`}>{l}</Link>} />
            ) : (
              <article key={p.id} className="s-card flex flex-col gap-4 p-5" data-testid={`card-plan-${p.id}`}>
                <header><h3 className="text-xl font-semibold">{p.name}</h3>{p.description && <p className="s-muted mt-1 text-sm">{p.description}</p>}</header>
                <Prices x={p} periods={p.billingPeriods} />
                {p.billingPeriods && p.billingPeriods.length > 0 && <p className="s-muted text-xs">Billing: {p.billingPeriods.join(' or ')}</p>}
                {readFeatureRows(p).length > 0 && <dl className="space-y-1 text-sm" data-testid={`list-plan-feature-rows-${p.id}`}>{readFeatureRows(p).map((r, i) => <div key={i} className="flex justify-between gap-3"><dt className="s-muted">{r.label}</dt><dd className="text-right break-words">{r.value}</dd></div>)}</dl>}
                {feats(p.entitlements).length > 0 && <ul className="space-y-1 text-sm" aria-label={`${p.name} included`}>
                  {feats(p.entitlements).map((e) => <li key={e.key} className="flex justify-between gap-3"><span>{label(e.key)}</span>{e.value !== true && <span className="s-mono shrink-0">{String(e.value)}</span>}</li>)}
                </ul>}
              </article>))}
          </div>}
        {addons.length > 0 && <div className="mt-8" data-testid="list-published-addons">
          <p className="s-eyebrow mb-3">Add-ons</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{addons.map((a) => (
            <article key={a.id} className="s-card space-y-2 p-5" data-testid={`card-addon-${a.id}`}>
              <h3 className="font-semibold">{a.name}</h3>{a.description && <p className="s-muted text-sm">{a.description}</p>}
              <Prices x={a} />
              {feats(a.entitlements).length > 0 && <ul className="space-y-1 text-sm">{feats(a.entitlements).map((e) => <li key={e.key} className="flex justify-between gap-3"><span>{label(e.key)}</span>{e.value !== true && <span className="s-mono">{String(e.value)}</span>}</li>)}</ul>}
            </article>))}</div>
        </div>}
      </div>
    </Section>
  );
}
