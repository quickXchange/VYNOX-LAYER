import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CapabilitiesEditor } from './capabilities-editor';
import { INTERVAL, MODES, SUPPORT, type PlanProfile } from './types';

type K = keyof PlanProfile;
const Field = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => <div className={`space-y-1.5 ${wide ? 'md:col-span-2' : ''}`}><Label>{label}</Label>{children}</div>;
const H = ({ children }: { children: ReactNode }) => <h3 className="mt-2 border-t pt-4 font-mono text-[11px] uppercase tracking-wider text-copper md:col-span-2">{children}</h3>;
const toLocal = (iso?: string | Date | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const intOrNull = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.trunc(Number(v)) || 0));

export function ProfileEditor({ value: p, onChange }: { value: PlanProfile; onChange: (p: PlanProfile) => void }) {
  const set = <T extends K>(k: T, v: PlanProfile[T]) => onChange({ ...p, [k]: v });
  const txt = (k: K, label: string, o: { mono?: boolean; wide?: boolean; ph?: string; area?: boolean } = {}) => <Field label={label} wide={o.wide}>{o.area
    ? <Textarea data-testid={`input-profile-${k}`} placeholder={o.ph} value={(p[k] as string) ?? ''} onChange={(e) => set(k, e.target.value as never)} />
    : <Input data-testid={`input-profile-${k}`} className={o.mono ? 'font-mono' : ''} placeholder={o.ph} value={(p[k] as string) ?? ''} onChange={(e) => set(k, e.target.value as never)} />}</Field>;
  const money = (k: 'fixedDiscountAmount' | 'promoPrice', label: string) => <Field label={label}><Input data-testid={`input-profile-${k}`} className="font-mono" inputMode="decimal" placeholder="Not set" value={p[k] ?? ''} onChange={(e) => set(k, e.target.value.trim() === '' ? null : e.target.value.trim())} /></Field>;
  const date = (k: 'promoStartsAt' | 'promoEndsAt', label: string) => <Field label={label}><Input type="datetime-local" data-testid={`input-profile-${k}`} value={toLocal(p[k])} onChange={(e) => set(k, e.target.value ? new Date(e.target.value).toISOString() : null)} /></Field>;
  const num = (k: K, label: string, ph = 'Not set') => <Field label={label}><Input data-testid={`input-profile-${k}`} className="font-mono" inputMode="numeric" placeholder={ph} value={p[k] == null ? '' : String(p[k])} onChange={(e) => set(k, intOrNull(e.target.value) as never)} /></Field>;
  const sw = (k: K, label: string, hint?: string) => <label className="flex items-start gap-3 rounded-sm border p-3"><Switch data-testid={`switch-profile-${k}`} checked={!!p[k]} onCheckedChange={(v) => set(k, v as never)} /><span><span className="block text-sm">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
  const sel = (k: K, label: string, opts: Record<string, string>) => <Field label={label}><Select value={(p[k] as string) ?? ''} onValueChange={(v) => set(k, v as never)}><SelectTrigger data-testid={`select-profile-${k}`}><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent>{Object.entries(opts).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <H>General</H>
      {txt('internalName', 'Internal name (admin only)')}{txt('publicName', 'Public name (blank uses plan name)')}
      {txt('slug', 'Slug (unique among active plans)', { mono: true, ph: 'standard' })}{txt('tagline', 'Tagline', { ph: 'Grow your volume' })}
      {txt('shortDescription', 'Short description', { wide: true })}
      {txt('fullDescription', 'Full description', { wide: true, area: true })}
      {txt('iconUrl', 'Icon URL (local path or https; uploads not supported)', { mono: true, ph: '/brand/icon.svg' })}{txt('imageUrl', 'Image URL (local path or https)', { mono: true })}
      {sel('visibility', 'Visibility', { public: 'Public', hidden: 'Hidden from public pricing' })}{sw('featured', 'Featured card', 'Highlights the card on the pricing page')}
      {sel('badgeType', 'Badge', { none: 'No badge', recommended: 'Recommended', custom: 'Custom' })}{txt('badgeLabel', 'Badge label', { ph: p.badgeType === 'recommended' ? 'Recommended' : '' })}
      {txt('promoText', 'Promotional text')}{txt('footerText', 'Card footer text')}
      {txt('ctaLabel', 'CTA label')}{txt('ctaUrl', 'CTA URL (local path only)', { mono: true, ph: '/contact' })}
      {txt('terms', 'Plan terms', { wide: true, area: true })}
      <H>Billing</H>
      {sel('pricingMode', 'Pricing mode', MODES)}{sel('billingInterval', 'Billing interval (must match enabled periods)', INTERVAL)}
      {p.pricingMode === 'contact_sales' && txt('contactSalesLabel', 'Contact-sales label')}
      {p.pricingMode === 'custom' && txt('customPriceText', 'Custom price text', { ph: 'Quoted per contract' })}
      {p.pricingMode === 'paid' && <>
        {money('fixedDiscountAmount', 'Fixed recurring discount (replaces percentage)')}{money('promoPrice', 'Promotional monthly price')}
        {date('promoStartsAt', 'Promotion starts')}{date('promoEndsAt', 'Promotion ends (exclusive)')}</>}
      <Field label="Trial days (0 = none; no automatic renewal)"><Input type="number" min={0} max={365} value={p.trialDays ?? 0} onChange={e => set('trialDays', Number(e.target.value))} data-testid="input-profile-trialDays" className="font-mono" /></Field>
      <p className="self-end text-xs text-muted-foreground">Trials need a billing scheduler, which does not exist yet.</p>
      <p className="text-xs text-muted-foreground md:col-span-2">Prices above set the mode's amounts. Quotes, invoices, estimates and the public card share one rule: an active promotion replaces the monthly price; otherwise a fixed discount is subtracted from monthly and yearly; otherwise the percentage applies. Orders keep the price from their submission time. No payment is collected automatically.</p>
      <H>Product</H>
      {num('convertProviderLimit', 'Convert provider limit', 'All eligible')}
      <Field label="Theme modes"><div className="flex gap-4 pt-2">{(['light', 'dark'] as const).map((m) => <label key={m} className="flex items-center gap-2 text-sm"><Switch data-testid={`switch-theme-${m}`} checked={(p.themeModes ?? []).includes(m)} onCheckedChange={(v) => set('themeModes', v ? [...(p.themeModes ?? []), m] : (p.themeModes ?? []).filter((x) => x !== m))} />{m}</label>)}</div></Field>
      {sw('poweredByFooter', 'Powered by VynoX footer', 'Off removes the badge')}<div />
      <Field label="Requested providers (names only, not integrations)" wide><Input data-testid="input-profile-requestedProviders" placeholder="ChangeNOW, SwapSpace, FixedFloat" value={(p.requestedProviders ?? []).join(', ')} onChange={(e) => set('requestedProviders', e.target.value.split(',').map((x) => x.trimStart()))} /></Field>
      <H>Administration and support</H>
      {num('adminSeats', 'Administrator seats', 'Per contract')}{sw('multiAdminRoles', 'Multiple admin roles', 'Requires implementation before customers can use it')}
      {sel('supportLevel', 'Support level', SUPPORT)}{num('supportResponseHours', 'Support response target (hours)')}
      {num('launchTargetBusinessDays', 'Launch target (business days)')}{sw('dedicatedManager', 'Dedicated manager')}
      {sw('slaEnabled', 'SLA')}{sw('earlyAccess', 'Early access to eligible features')}
      {txt('slaTerms', 'SLA terms', { wide: true, area: true })}
      <H>Features</H>
      <div className="md:col-span-2"><CapabilitiesEditor value={p.capabilities ?? []} onChange={(v) => set('capabilities', v)} /></div>
      <H>Internal</H>
      {txt('internalNotes', 'Internal notes (never published)', { wide: true, area: true })}
    </div>
  );
}
