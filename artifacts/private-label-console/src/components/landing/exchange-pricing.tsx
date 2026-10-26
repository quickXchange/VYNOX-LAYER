import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { PUBLISHED_PLANS_KEY } from './published-plans';
import { PlanCard, type PreviewPlan } from '@/components/plan-management/plan-card-preview';

type Plan = PreviewPlan & { billingPeriods?: string[] };
const remember = (id: string) => { try { sessionStorage.setItem('vynox-intended-plan', id); } catch { /* storage optional */ } };

/** Primary Exchange pricing: renders only the published offering through the shared PlanCard. No fallback tiers. */
export function ExchangePricing({ tiers }: { tiers?: { label: string; planId: string | null }[] }) {
  const pub = useQuery({ queryKey: PUBLISHED_PLANS_KEY, staleTime: 5000, refetchInterval: 10000, refetchOnWindowFocus: true, queryFn: async () => { const r = await fetch(`${import.meta.env.BASE_URL}api/phase1/catalog`); if (!r.ok) throw new Error('Could not load published plans.'); return await r.json() as { plans: Plan[] }; } });
  const published = pub.data?.plans ?? [];
  const referenced = (tiers ?? []).flatMap((t) => published.filter((p) => p.id === t.planId));
  const plans = [...referenced, ...published.filter((p) => !referenced.some((r) => r.id === p.id))];
  return (
    <section id="pricing" className="vx-sec scroll-mt-24" aria-labelledby="vx-pricing-h" data-testid="section-exchange-pricing">
      <div className="s-wrap">
        <p className="s-eyebrow">Exchange plans</p>
        <h2 id="vx-pricing-h" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Choose your Exchange plan</h2>
        <p className="s-muted mt-2 max-w-2xl text-sm">Shown exactly as published. Contact-sales plans open a request with the plan preselected; pricing is confirmed during review and nothing is charged.</p>
        <div className="mt-6" aria-live="polite">
          {pub.isLoading ? <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="s-card h-80 animate-pulse" />)}</div>
            : pub.isError ? <div role="alert" className="vx-card"><p>Could not load published plans.</p><button type="button" className="s-muted mt-2 text-sm underline" onClick={() => pub.refetch()} data-testid="button-retry-pricing">Try again</button></div>
            : plans.length === 0 ? <div className="vx-card text-center" data-testid="empty-exchange-pricing"><p className="text-xl font-semibold">Pricing on request</p><p className="s-muted mt-1 text-sm">No plans are published right now.</p><Link href="/account/configure" className="s-btn s-btn-ghost mt-3 inline-flex" data-testid="link-pricing-request">Request a quote<ArrowRight size={16} /></Link></div>
            : <div className={`grid gap-4 md:grid-cols-2 ${plans.length >= 3 ? 'lg:grid-cols-3' : ''}`} data-testid="list-exchange-plans">
              {plans.map((p) => <PlanCard key={p.id} plan={p} cta={(href, l) => <Link href={href} onClick={() => remember(p.id)} className="s-btn s-btn-primary w-full justify-between" data-testid={`link-order-plan-${p.id}`}>{l}<ArrowRight size={16} /></Link>} />)}
            </div>}
        </div>
      </div>
    </section>
  );
}
