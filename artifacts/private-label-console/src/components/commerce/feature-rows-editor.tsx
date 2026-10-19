import { useRef } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FEATURE_LABEL_MAX, FEATURE_VALUE_MAX, moveRow, type FeatureRow } from '@/lib/feature-rows';

export function FeatureRowsEditor({ value, onChange }: { value: FeatureRow[]; onChange: (v: FeatureRow[]) => void }) {
  const box = useRef<HTMLOListElement>(null);
  const focusRow = (i: number) => requestAnimationFrame(() => box.current?.querySelector<HTMLInputElement>(`[data-row="${i}"]`)?.focus());
  const patch = (i: number, k: keyof FeatureRow, v: string) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-sm text-muted-foreground">Customer-visible descriptive rows, for example "Tier: Starter" or "Support: Business hours". They are descriptive only and grant no entitlement rights; access is controlled solely by the entitlements below. Rows appear publicly after the next pricing publication.</p>
      {value.length === 0 ? <p className="rounded border border-dashed p-3 text-sm text-muted-foreground" data-testid="text-feature-rows-empty">No descriptive rows. Customers see only the entitlements.</p> : (
        <ol ref={box} className="space-y-2" aria-label="Customer-visible feature rows">
          {value.map((r, i) => {
            const lb = !r.label.trim() || r.label.trim().length > FEATURE_LABEL_MAX; const vb = !r.value.trim() || r.value.trim().length > FEATURE_VALUE_MAX;
            return (
              <li key={i} className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[2.5rem_1fr_2fr_auto] md:items-start" data-testid={`row-feature-${i}`}>
                <span className="font-mono text-xs text-muted-foreground md:pt-2.5">{String(i + 1).padStart(2, '0')}</span>
                <div className="space-y-1"><label htmlFor={`fr-l-${i}`} className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Label</label>
                  <Input id={`fr-l-${i}`} data-row={i} data-testid={`input-feature-label-${i}`} maxLength={FEATURE_LABEL_MAX} aria-invalid={lb} value={r.label} onChange={(e) => patch(i, 'label', e.target.value)} />
                  <span className="block text-right font-mono text-[10px] text-muted-foreground">{r.label.length}/{FEATURE_LABEL_MAX}</span></div>
                <div className="space-y-1"><label htmlFor={`fr-v-${i}`} className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Value</label>
                  <Textarea id={`fr-v-${i}`} rows={1} className="min-h-9" data-testid={`input-feature-value-${i}`} maxLength={FEATURE_VALUE_MAX} aria-invalid={vb} value={r.value} onChange={(e) => patch(i, 'value', e.target.value)} />
                  <span className="block text-right font-mono text-[10px] text-muted-foreground">{r.value.length}/{FEATURE_VALUE_MAX}</span></div>
                <div className="flex gap-1 md:pt-5">
                  <Button type="button" size="icon" variant="ghost" aria-label={`Move row ${i + 1} up`} disabled={i === 0} data-testid={`button-feature-up-${i}`} onClick={() => { onChange(moveRow(value, i, i - 1)); focusRow(i - 1); }}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Move row ${i + 1} down`} disabled={i === value.length - 1} data-testid={`button-feature-down-${i}`} onClick={() => { onChange(moveRow(value, i, i + 1)); focusRow(i + 1); }}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="text-destructive" aria-label={`Remove row ${i + 1}`} data-testid={`button-feature-remove-${i}`} onClick={() => { onChange(value.filter((_, j) => j !== i)); if (value.length > 1) focusRow(Math.max(0, i - 1)); }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>);
          })}
        </ol>)}
      <Button type="button" variant="outline" size="sm" data-testid="button-add-feature-row" onClick={() => { onChange([...value, { label: '', value: '' }]); focusRow(value.length); }}><Plus className="mr-1 h-4 w-4" /> Add row</Button>
    </div>
  );
}

/** Read-only list used by customer and preview surfaces. */
export function FeatureRowList({ rows, className = '', testid }: { rows: FeatureRow[]; className?: string; testid?: string }) {
  if (!rows.length) return null;
  return (
    <dl className={`mt-2 space-y-0.5 text-xs ${className}`} data-testid={testid}>
      {rows.map((r, i) => <div key={i} className="flex gap-2"><dt className="shrink-0 text-muted-foreground">{r.label}</dt><dd className="min-w-0 break-words">{r.value}</dd></div>)}
    </dl>
  );
}
