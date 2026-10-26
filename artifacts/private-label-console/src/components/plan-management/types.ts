import type { PlanProfile, PlanCapability } from '@workspace/api-client-react';
export type { PlanProfile, PlanCapability };
export const AVAIL: Record<PlanCapability['availability'], string> = { available: 'Available', requires_configuration: 'Requires configuration', unavailable: 'Unavailable, requires implementation' };
export const STATE: Record<PlanCapability['state'], string> = { included: 'Included', excluded: 'Excluded', optional: 'Optional', limited: 'Limited', unlimited: 'Unlimited', unavailable: 'Unavailable' };
export const SUPPORT: Record<string, string> = { email: 'Email support', priority: 'Priority support', dedicated: 'Dedicated manager' };
export const INTERVAL: Record<string, string> = { monthly: 'Monthly', yearly: 'Yearly', monthly_and_yearly: 'Monthly or yearly', custom: 'Custom term' };
export const MODES: Record<string, string> = { paid: 'Paid (configured prices)', free: 'Free (prices exactly 0)', custom: 'Custom pricing text', contact_sales: 'Contact sales' };
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const LOCAL_URL = /^\/(?!\/)[A-Za-z0-9/_#?=&.-]*$/;
export const MONEY = /^[0-9]+(?:\.[0-9]{1,2})?$/;
export const safeLocal = (u: string) => LOCAL_URL.test(u) && !u.includes('..');
export const safeMedia = (u: string) => { if (u.startsWith('/')) return safeLocal(u); try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && x.hostname.includes('.'); } catch { return false; } };
export const blankCapability = (n: number): PlanCapability => ({ key: `feature_${n}`, label: '', description: '', group: '', state: 'included', availability: 'unavailable', limitValue: null, unit: '', tooltip: '', highlight: false, publicVisible: true, badge: '', dependsOn: [], note: '' });
export const blankProfile = (): PlanProfile => ({ slug: '', internalName: '', publicName: '', tagline: '', shortDescription: '', fullDescription: '', iconUrl: '', imageUrl: '', badgeType: 'none', badgeLabel: '', featured: false, footerText: '', promoText: '', terms: '',
  pricingMode: 'contact_sales', contactSalesLabel: 'Contact sales', customPriceText: '', fixedDiscountAmount: null, promoPrice: null, promoStartsAt: null, promoEndsAt: null, billingInterval: 'monthly_and_yearly', trialDays: 0,
  ctaLabel: 'Contact sales', ctaUrl: '/contact', visibility: 'public', adminSeats: null, multiAdminRoles: false, supportLevel: 'email', supportResponseHours: null, launchTargetBusinessDays: null, dedicatedManager: false, slaEnabled: false, slaTerms: '', earlyAccess: false, poweredByFooter: true, themeModes: ['light', 'dark'], convertProviderLimit: null, requestedProviders: [], capabilities: [], internalNotes: '' });

type Prices = { configured: boolean; monthly: string; yearly: string; discount: string };
/** Mirrors the server rules so errors show before review; the server remains authoritative. */
export function profileError(p: PlanProfile, pr: Prices, periods?: { monthly: boolean; yearly: boolean }): string {
  if (p.slug && !SLUG.test(p.slug)) return 'Slug: lowercase letters, digits and hyphens';
  if (p.ctaUrl && !safeLocal(p.ctaUrl)) return 'CTA URL must be a local path such as /contact';
  if (p.iconUrl && !safeMedia(p.iconUrl)) return 'Icon URL must be a local path or https URL';
  if (p.imageUrl && !safeMedia(p.imageUrl)) return 'Image URL must be a local path or https URL';
  if (p.badgeType === 'custom' && !p.badgeLabel?.trim()) return 'A custom badge needs a label';
  const mode = p.pricingMode ?? (pr.configured ? 'paid' : 'contact_sales');
  const m = Number(pr.monthly), y = Number(pr.yearly), pct = Number(pr.discount || 0);
  if (mode === 'paid' && !pr.configured) return 'Paid plans need configured prices';
  if (mode === 'free' && (!pr.configured || m !== 0 || y !== 0)) return 'Free plans need configured recurring prices of 0';
  if ((mode === 'custom' || mode === 'contact_sales') && pr.configured) return 'Custom and contact-sales plans must leave prices unconfigured';
  if (mode === 'custom' && !p.customPriceText?.trim()) return 'Custom pricing needs public price text';
  if (!Number.isInteger(p.trialDays ?? 0) || (p.trialDays ?? 0) < 0 || (p.trialDays ?? 0) > 365) return 'Trial duration must be 0–365 whole days';
  const fixed = p.fixedDiscountAmount ? Number(p.fixedDiscountAmount) : 0;
  if (p.fixedDiscountAmount && !MONEY.test(p.fixedDiscountAmount)) return 'Fixed discount must be a decimal amount';
  if (p.promoPrice && !MONEY.test(p.promoPrice)) return 'Promotional price must be a decimal amount';
  if (mode !== 'paid' && (fixed > 0 || p.promoPrice || pct > 0 || (p.trialDays ?? 0) > 0)) return 'Discounts, promotions and trials apply only to paid plans';
  if (fixed > 0 && (pct > 0 || fixed >= m || fixed >= y)) return 'Fixed discount: no percentage discount, and lower than monthly and yearly price';
  if (p.promoPrice || p.promoStartsAt || p.promoEndsAt) {
    if (!p.promoPrice || !p.promoStartsAt || !p.promoEndsAt) return 'A promotion needs price, start and end';
    if (new Date(p.promoStartsAt as string) >= new Date(p.promoEndsAt as string)) return 'Promotion must end after it starts';
    if (Number(p.promoPrice) >= m) return 'Promotional price must be lower than the monthly price';
  }
  if (p.billingInterval === 'custom' && mode === 'paid') return 'Paid plans need a monthly and/or yearly interval';
  if (periods) {
    const iv = p.billingInterval;
    if ((iv === 'monthly' || iv === 'monthly_and_yearly') && !periods.monthly) return 'Monthly interval selected but the monthly period is disabled below';
    if ((iv === 'yearly' || iv === 'monthly_and_yearly') && !periods.yearly) return 'Yearly interval selected but the yearly period is disabled below';
    if (iv === 'monthly' && periods.yearly) return 'Monthly-only interval: disable the yearly period below first';
    if (iv === 'yearly' && periods.monthly) return 'Yearly-only interval: disable the monthly period below first';
  }
  const caps = p.capabilities ?? []; const keys = caps.map((c) => c.key); const byKey = new Map(caps.map((c) => [c.key, c]));
  if (keys.some((k) => !/^[a-z][a-z0-9_]{1,63}$/.test(k))) return 'Capability keys: lowercase snake_case, 2+ characters';
  if (new Set(keys).size !== keys.length) return 'Capability keys must be unique';
  for (const c of caps) {
    if (!c.label.trim()) return 'Every capability needs a label';
    if (c.state === 'limited' && c.limitValue == null) return `${c.label}: limited needs a numeric limit`;
    if (c.state !== 'limited' && c.limitValue != null) return `${c.label}: only limited features carry a limit`;
    if (c.state === 'unavailable' && c.availability === 'available') return `${c.label}: unavailable cannot be marked available`;
    for (const dep of c.dependsOn ?? []) { const d = byKey.get(dep); if (!d || dep === c.key) return `${c.label}: unknown dependency ${dep}`;
      if (!['excluded', 'unavailable'].includes(c.state) && ['excluded', 'unavailable'].includes(d.state)) return `${c.label} requires ${d.label}`; }
  }
  return '';
}

type Priced = { monthlyPrice: string | null; yearlyPrice: string | null; discountPercent?: string | null; profile?: Partial<PlanProfile> | null };
const cts = (v: string) => Math.round(Number(v) * 100);
export const promotionActive = (pr: Partial<PlanProfile> | null | undefined, at = new Date()) => !!pr?.promoPrice && !!pr.promoStartsAt && !!pr.promoEndsAt && new Date(pr.promoStartsAt as string) <= at && at < new Date(pr.promoEndsAt as string);
/** Mirror of the server's effectiveRecurring (commercial-pricing.ts). Display only; the server prices orders. */
export function effectiveRecurring(x: Priced, period: 'monthly' | 'yearly', at = new Date()): string | null {
  const base = period === 'monthly' ? x.monthlyPrice : x.yearlyPrice; if (base == null) return null;
  const p = x.profile;
  if (period === 'monthly' && promotionActive(p, at)) return (Math.min(cts(p!.promoPrice!), cts(base)) / 100).toFixed(2);
  if (p?.fixedDiscountAmount && cts(p.fixedDiscountAmount) > 0) return (Math.max(0, cts(base) - cts(p.fixedDiscountAmount)) / 100).toFixed(2);
  const bp = Math.round(Number(x.discountPercent ?? 0) * 100);
  return (Math.floor((cts(base) * (10000 - bp) + 5000) / 10000) / 100).toFixed(2);
}
