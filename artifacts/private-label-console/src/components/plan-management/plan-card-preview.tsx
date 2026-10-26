import type { ReactNode } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { AVAIL, INTERVAL, STATE, SUPPORT, effectiveRecurring, promotionActive, safeMedia, type PlanCapability, type PlanProfile } from './types';

type Ent = { key: string; value: boolean | string };
export type PreviewPlan = { id: string; name: string; description?: string; monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; currency: string; discountPercent?: string | null; pricingConfigured?: boolean; featureRows?: { label: string; value: string }[]; entitlements?: Ent[]; profile?: Partial<PlanProfile> };
const money = (v: string | number, c: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(Number(v)); } catch { return `${v} ${c}`; } };
const icon = (c: PlanCapability) => (c.state === 'excluded' || c.state === 'unavailable' ? <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : c.state === 'optional' ? <Plus className="mt-0.5 h-4 w-4 shrink-0 text-copper" /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-copper" />);

function Price({ p, pr }: { p: PreviewPlan; pr: Partial<PlanProfile> }) {
  const mode = pr.pricingMode ?? (p.pricingConfigured === false || p.monthlyPrice == null ? 'contact_sales' : 'paid');
  if (mode === 'contact_sales') return <p className="text-xl font-semibold">{pr.contactSalesLabel || 'Contact sales'}</p>;
  if (mode === 'custom') return <p className="text-xl font-semibold">{pr.customPriceText || 'Custom pricing'}</p>;
  if (mode === 'free' || p.monthlyPrice == null) return <p className="text-2xl font-semibold">{mode === 'free' ? 'Free' : 'Pricing on request'}</p>;
  const fixed = Number(pr.fixedDiscountAmount ?? 0), pct = Number(p.discountPercent ?? 0);
  const priced = { monthlyPrice: p.monthlyPrice, yearlyPrice: p.yearlyPrice, discountPercent: p.discountPercent, profile: pr };
  const promo = promotionActive(pr);
  return <>
    {promo ? <p className="text-2xl font-semibold tracking-tight">{money(effectiveRecurring(priced, 'monthly')!, p.currency)}<span className="ml-2 text-sm font-normal text-muted-foreground line-through">{money(p.monthlyPrice, p.currency)}</span><span className="ml-1 text-xs font-normal text-muted-foreground">per month until {new Date(pr.promoEndsAt as string).toLocaleDateString()}</span></p>
      : <p className="text-2xl font-semibold tracking-tight">{money(effectiveRecurring(priced, 'monthly')!, p.currency)}<span className="ml-1 text-xs font-normal text-muted-foreground">per month</span></p>}
    {p.yearlyPrice != null && <p className="text-sm text-muted-foreground">{money(effectiveRecurring(priced, 'yearly')!, p.currency)} per year</p>}
    {(fixed > 0 || pct > 0) && <p className="text-xs text-muted-foreground">{fixed > 0 ? `${money(fixed, p.currency)} off` : `${pct}% off`} recurring prices</p>}
    {p.setupFee != null && Number(p.setupFee) > 0 && <p className="text-xs text-muted-foreground">One-time setup {money(p.setupFee, p.currency)}</p>}
    {(pr.trialDays ?? 0) > 0 && <p className="text-xs text-muted-foreground">{pr.trialDays}-day trial</p>}
  </>;
}

/** Contact-sales and default CTAs open the real request flow (sign-in first if needed) with the plan preselected. */
export function planCtaHref(p: { id: string; profile?: Partial<PlanProfile> | null }) {
  const url = p.profile?.ctaUrl;
  return !url || url === '/contact' ? `/account/configure?selectedPlanId=${encodeURIComponent(p.id)}` : url;
}
/** Same card for the admin draft preview and the public pricing page. */
export function PlanCard({ plan: p, cta }: { plan: PreviewPlan; cta?: (href: string, label: string) => ReactNode }) {
  const pr = p.profile ?? {};
  const caps = (pr.capabilities ?? []).filter((c) => c.publicVisible !== false);
  const groups = [...new Set(caps.map((c) => c.group || ''))];
  const badge = pr.badgeType === 'recommended' ? pr.badgeLabel || 'Recommended' : pr.badgeType === 'custom' ? pr.badgeLabel : '';
  const facts: [string, string][] = [];
  if (pr.supportLevel) facts.push(['Support', SUPPORT[pr.supportLevel] + (pr.supportResponseHours ? `, ${pr.supportResponseHours} h target` : '')]);
  if (pr.launchTargetBusinessDays) facts.push(['Launch target', `${pr.launchTargetBusinessDays} business days`]);
  if (pr.adminSeats) facts.push(['Admin seats', String(pr.adminSeats)]);
  if (pr.convertProviderLimit != null) facts.push(['Convert providers', `Up to ${pr.convertProviderLimit}`]);
  if (pr.themeModes?.length) facts.push(['Themes', pr.themeModes.join(' and ')]);
  if (pr.dedicatedManager) facts.push(['Dedicated manager', 'Included']);
  if (pr.slaEnabled) facts.push(['SLA', pr.slaTerms || 'Included']);
  if (pr.earlyAccess) facts.push(['Early access', 'Eligible features']);
  if (pr.poweredByFooter === false) facts.push(['VynoX footer badge', 'Removed']);
  const req = (pr.requestedProviders ?? []).filter(Boolean); if (req.length) facts.push(['Requested providers', `${req.join(', ')} (on request)`]);
  return (
    <article className={`relative flex flex-col gap-4 rounded-md border bg-card p-5 ${pr.featured ? 'border-copper ring-1 ring-copper/40' : ''}`} data-testid={`card-plan-${p.id}`}>
      {badge && <span className="absolute -top-2.5 right-4 rounded-sm bg-copper px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-background" data-testid={`badge-plan-${p.id}`}>{badge}</span>}
      {pr.imageUrl && safeMedia(pr.imageUrl) && <img src={pr.imageUrl} alt="" className="h-28 w-full rounded-sm object-cover" referrerPolicy="no-referrer" loading="lazy" />}
      <header className="flex gap-3">
        {pr.iconUrl && safeMedia(pr.iconUrl) && <img src={pr.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-sm object-contain" referrerPolicy="no-referrer" loading="lazy" />}
        <div><h3 className="font-display text-2xl">{pr.publicName || p.name}</h3>
          {pr.tagline && <p className="font-mono text-[11px] uppercase tracking-wider text-copper">{pr.tagline}</p>}
          {(pr.shortDescription || p.description) && <p className="mt-2 text-sm text-muted-foreground">{pr.shortDescription || p.description}</p>}</div>
      </header>
      {pr.promoText && <p className="rounded-sm border border-copper/40 px-2 py-1 text-xs text-copper">{pr.promoText}</p>}
      <div data-testid={`text-plan-price-${p.id}`}><Price p={p} pr={pr} />{pr.billingInterval && <p className="text-xs text-muted-foreground">Billing: {INTERVAL[pr.billingInterval]}</p>}</div>
      {pr.fullDescription && <details className="text-sm"><summary className="cursor-pointer text-xs text-muted-foreground">Details</summary><p className="mt-1 whitespace-pre-line">{pr.fullDescription}</p></details>}
      {groups.map((g) => (
        <div key={g || 'features'}>{g && <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{g}</p>}
          <ul className="space-y-1.5 text-sm">{caps.filter((c) => (c.group || '') === g).map((c) => (
            <li key={c.key} className={`flex gap-2 ${c.highlight ? 'font-medium' : ''}`} title={c.tooltip || undefined} data-testid={`feature-${p.id}-${c.key}`}>{icon(c)}
              <span className={c.state === 'excluded' || c.state === 'unavailable' ? 'text-muted-foreground' : ''}>{c.label}
                {c.state === 'limited' && c.limitValue != null && <span className="ml-1 font-mono text-xs">(up to {c.limitValue}{c.unit ? ` ${c.unit}` : ''})</span>}
                {c.state === 'unlimited' && <span className="ml-1 font-mono text-xs">(unlimited)</span>}
                {c.state === 'optional' && <span className="ml-1 text-xs text-muted-foreground">(optional)</span>}
                {c.badge && <span className="ml-1 rounded-sm border px-1 font-mono text-[9px] uppercase">{c.badge}</span>}
                {c.description && <span className="block text-xs text-muted-foreground">{c.description}</span>}
                {(c.availability !== 'available' || c.state === 'unavailable') && !['excluded'].includes(c.state) && <span className="block text-[11px] text-muted-foreground">{c.note || (c.state === 'unavailable' ? STATE.unavailable : AVAIL[c.availability])}</span>}</span></li>))}</ul></div>))}
      {(p.featureRows ?? []).length > 0 && <dl className="space-y-1 text-sm">{p.featureRows!.map((r, i) => <div key={i} className="flex justify-between gap-3"><dt className="text-muted-foreground">{r.label}</dt><dd className="text-right">{r.value}</dd></div>)}</dl>}
      {facts.length > 0 && <dl className="space-y-1 border-t pt-3 text-xs">{facts.map(([l, v]) => <div key={l} className="flex justify-between gap-3"><dt className="text-muted-foreground">{l}</dt><dd className="text-right">{v}</dd></div>)}</dl>}
      {pr.terms && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Plan terms</summary><p className="mt-1 whitespace-pre-line">{pr.terms}</p></details>}
      <div className="mt-auto space-y-2 pt-2">{cta ? cta(planCtaHref(p), pr.ctaLabel || 'Contact sales') : <span className="inline-flex w-full justify-center rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">{pr.ctaLabel || 'Contact sales'}</span>}
        {pr.footerText && <p className="text-center text-[11px] text-muted-foreground">{pr.footerText}</p>}</div>
    </article>
  );
}
