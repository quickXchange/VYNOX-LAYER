import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AVAIL, STATE, blankCapability, type PlanCapability } from './types';

const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="space-y-1 text-xs"><span className="block font-mono uppercase tracking-wider text-muted-foreground">{t}</span>{children}</label>;
export function CapabilitiesEditor({ value, onChange }: { value: PlanCapability[]; onChange: (v: PlanCapability[]) => void }) {
  const upd = (i: number, patch: Partial<PlanCapability>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: number) => { const n = [...value]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="rounded-sm border border-dashed p-4 text-sm text-muted-foreground">No structured features yet. Add one per feature, with its commercial state and real implementation status.</p>}
      {value.map((c, i) => (
        <fieldset key={i} className="grid gap-3 rounded-sm border p-3 md:grid-cols-4" data-testid={`row-capability-${i}`}>
          <L t="Key"><Input className="font-mono text-xs" value={c.key} onChange={(e) => upd(i, { key: e.target.value.toLowerCase() })} data-testid={`input-capability-key-${i}`} /></L>
          <L t="Label"><Input value={c.label} onChange={(e) => upd(i, { label: e.target.value })} data-testid={`input-capability-label-${i}`} /></L>
          <L t="Group"><Input value={c.group ?? ''} onChange={(e) => upd(i, { group: e.target.value })} data-testid={`input-capability-group-${i}`} /></L>
          <L t="Badge"><Input value={c.badge ?? ''} onChange={(e) => upd(i, { badge: e.target.value })} data-testid={`input-capability-badge-${i}`} /></L>
          <L t="State"><Select value={c.state} onValueChange={(v) => upd(i, { state: v as PlanCapability['state'], ...(v !== 'limited' ? { limitValue: null, unit: '' } : {}) })}>
            <SelectTrigger data-testid={`select-capability-state-${i}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATE).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></L>
          <L t="Implementation"><Select value={c.availability} onValueChange={(v) => upd(i, { availability: v as PlanCapability['availability'] })}>
            <SelectTrigger data-testid={`select-capability-availability-${i}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(AVAIL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></L>
          <L t="Limit"><Input className="font-mono text-xs" inputMode="decimal" disabled={c.state !== 'limited'} value={c.limitValue == null ? '' : String(c.limitValue)} onChange={(e) => upd(i, { limitValue: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} data-testid={`input-capability-limit-${i}`} /></L>
          <L t="Unit"><Input disabled={c.state !== 'limited'} value={c.unit ?? ''} onChange={(e) => upd(i, { unit: e.target.value })} data-testid={`input-capability-unit-${i}`} /></L>
          <span className="md:col-span-2"><L t="Description"><Input value={c.description ?? ''} onChange={(e) => upd(i, { description: e.target.value })} data-testid={`input-capability-description-${i}`} /></L></span>
          <L t="Tooltip"><Input value={c.tooltip ?? ''} onChange={(e) => upd(i, { tooltip: e.target.value })} data-testid={`input-capability-tooltip-${i}`} /></L>
          <L t="Public note"><Input value={c.note ?? ''} onChange={(e) => upd(i, { note: e.target.value })} /></L>
          <span className="md:col-span-2"><L t="Depends on (keys, comma separated)"><Input className="font-mono text-xs" value={(c.dependsOn ?? []).join(', ')} onChange={(e) => upd(i, { dependsOn: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} data-testid={`input-capability-deps-${i}`} /></L></span>
          <span className="flex flex-wrap items-end gap-3 md:col-span-2">
            <label className="flex items-center gap-2 text-xs"><Switch checked={c.highlight ?? false} onCheckedChange={(v) => upd(i, { highlight: v })} data-testid={`switch-capability-highlight-${i}`} />Highlight</label>
            <label className="flex items-center gap-2 text-xs"><Switch checked={c.publicVisible !== false} onCheckedChange={(v) => upd(i, { publicVisible: v })} data-testid={`switch-capability-public-${i}`} />Public</label>
            <span className="ml-auto flex">
              <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove" data-testid={`button-capability-remove-${i}`}><Trash2 className="h-4 w-4" /></Button></span>
          </span>
        </fieldset>))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, blankCapability(value.length + 1)])} data-testid="button-capability-add"><Plus className="mr-1 h-4 w-4" />Add feature</Button>
      <p className="text-xs text-muted-foreground">State is what the plan sells; implementation status is what the platform can actually do. Marking a feature available never activates an integration.</p>
    </div>
  );
}
