import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StandardDesignPreview } from './design-preview';
import { Textarea } from '@/components/ui/textarea';
import { Uploader } from '@/components/customer/attachments';
import { initialCfg, type StepProps } from './configure-state';

const DEF = initialCfg();

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => <label className="block space-y-1 text-sm"><span>{label}</span>{children}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</label>;

export function ProjectStep({ cfg, set }: StepProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Brand name (required)"><Input data-testid="input-brand" required minLength={2} value={cfg.brandName} onChange={(e) => set({ brandName: e.target.value })} maxLength={100} /></Field>
      <Field label="Preferred domain (required)"><Input data-testid="input-domain" required value={cfg.domain} onChange={(e) => set({ domain: e.target.value })} maxLength={253} placeholder="exchange.example.com" /></Field>
    </div>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const norm = (v: string) => { const t = v.trim(); return t.startsWith('#') ? t : `#${t}`; };

function Color({ id, label, value, fallback, onChange }: { id: string; label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft((d) => (HEX.test(norm(d)) && norm(d).toLowerCase() === value.toLowerCase() ? d : value)); }, [value]);
  const bad = !HEX.test(norm(draft));
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={`hex-${id}`}>{label} <span className="text-muted-foreground">(optional)</span></label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} value={value} onChange={(e) => { onChange(e.target.value); setDraft(e.target.value); }} className="h-10 w-12 shrink-0 cursor-pointer rounded border bg-background p-0.5" data-testid={`picker-${id}`} />
        <Input id={`hex-${id}`} value={draft} maxLength={7} spellCheck={false} autoComplete="off" aria-invalid={bad} aria-describedby={`hint-${id}`} className="w-28 font-mono uppercase"
          onChange={(e) => { const v = e.target.value; setDraft(v); if (HEX.test(norm(v))) onChange(norm(v).toLowerCase()); }} data-testid={`input-hex-${id}`} />
        {value.toLowerCase() !== fallback && <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(fallback); setDraft(fallback); }} data-testid={`button-default-${id}`}>Default</Button>}
      </div>
      <p id={`hint-${id}`} className={`text-xs ${bad ? 'text-destructive' : 'text-muted-foreground'}`}>{bad ? `Use a 6-digit hex code like #1A2B3C. Preview keeps ${value.toUpperCase()}.` : 'Hex code, for example #12423F'}</p>
    </div>
  );
}

export function DesignStep({ cfg, set, onBusy }: StepProps) {
  const custom = cfg.designType === 'custom';
  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="Design type" className="grid gap-3 md:grid-cols-2">
        {([['standard', 'Standard design', 'Use the existing Exchange master design with your logo and colors.'], ['custom', 'Custom design (paid review)', 'Describe the look you want. An operator reviews it and quotes a customization fee. Nothing is generated automatically.']] as const).map(([v, t, d]) => (
          <button type="button" role="radio" aria-checked={cfg.designType === v} key={v} data-testid={`design-${v}`} onClick={() => set({ designType: v })} className={`rounded-md border p-4 text-left transition-colors ${cfg.designType === v ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card hover:bg-muted/50'}`}>
            <p className="font-display text-xl">{t}</p><p className="mt-1 text-sm text-muted-foreground">{d}</p>
          </button>))}
      </div>
      <div className="space-y-2"><p className="text-sm">Logo</p><Uploader category="logo" single label="Upload logo" items={cfg.logo ? [cfg.logo] : []} onAdd={(a) => set({ logo: a })} onRemove={() => set({ logo: null })} onBusy={onBusy} /></div>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <Color id="primary" label="Primary color" value={cfg.primary} fallback={DEF.primary} onChange={(v) => set({ primary: v })} />
        <Color id="accent" label="Accent color" value={cfg.accent} fallback={DEF.accent} onChange={(v) => set({ accent: v })} />
        <fieldset className="text-sm"><legend className="mb-1">Theme</legend><div className="flex gap-1 rounded-md border p-1">
          {(['light', 'dark', 'both'] as const).map((t) => <button type="button" key={t} aria-pressed={cfg.theme === t} data-testid={`theme-${t}`} onClick={() => set({ theme: t })} className={`rounded px-3 py-1 capitalize ${cfg.theme === t ? 'bg-primary text-primary-foreground' : ''}`}>{t}</button>)}
        </div></fieldset>
      </div>
      {!custom && <StandardDesignPreview brandName={cfg.brandName} primary={cfg.primary} accent={cfg.accent} theme={cfg.theme} logo={cfg.logo} />}
      {custom && <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="text-custom-no-preview">A custom design is produced only after paid operator review, so no automatic preview is shown. Switch to Standard design to preview the Exchange master with your brand.</p>}
      {custom && (
        <div className="space-y-4 rounded-md border border-dashed p-4">
          <Field label="Style name"><Input data-testid="input-style" value={cfg.styleName} onChange={(e) => set({ styleName: e.target.value })} maxLength={100} /></Field>
          <Field label="Design description"><Textarea value={cfg.description} onChange={(e) => set({ description: e.target.value })} maxLength={3000} /></Field>
          <Field label="Reference website URL (optional)"><Input value={cfg.refUrl} onChange={(e) => set({ refUrl: e.target.value })} maxLength={500} placeholder="https://" /></Field>
          <Field label="Design notes"><Textarea value={cfg.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={3000} /></Field>
          <div className="space-y-2"><p className="text-sm">Reference uploads</p><Uploader category="design_reference" label="Upload references" items={cfg.refs} onAdd={(a) => set((c) => ({ refs: [...c.refs, a] }))} onRemove={(id) => set((c) => ({ refs: c.refs.filter((x) => x.id !== id) }))} onBusy={onBusy} /></div>
        </div>)}
    </div>
  );
}
