import { useState } from 'react';
import { useGetPlanMigrationPreview, getGetPlanMigrationPreviewQueryKey, type Plan } from '@workspace/api-client-react';
import { ListSkeleton } from '@/components/app/bits';
import { Panel, Pill, ReviewDialog } from '@/components/super-admin/kit';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { usePmMutations } from './api';

const v = (x: unknown) => (x == null ? 'none' : String(x));
export function MigrationPanel({ plan, plans }: { plan: Plan; plans: Plan[] }) {
  const [to, setTo] = useState(''); const [sel, setSel] = useState<Set<string>>(new Set()); const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null);
  const q = useGetPlanMigrationPreview(plan.id, { targetPlanId: to }, { query: { enabled: !!to, queryKey: getGetPlanMigrationPreviewQueryKey(plan.id, { targetPlanId: to }), retry: false } }); const { migrate } = usePmMutations(); const { toast } = useToast();
  const targets = plans.filter((p) => p.status === 'enabled' || p.id === plan.id);
  const subs = q.data?.subscribers ?? [];
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Panel title="Customer contracts" note="Catalog edits never change existing customers. Targets are compared against the PUBLISHED plan, not this draft; publish first. Each subscription keeps its frozen contract until you explicitly move it here. Moving to the same plan refreshes the contract to the current catalog. No billing is performed.">
      <div className="mb-3 max-w-sm"><Select value={to} onValueChange={(x) => { setTo(x); setSel(new Set()); }}><SelectTrigger data-testid="select-migration-target"><SelectValue placeholder="Choose target plan to preview" /></SelectTrigger>
        <SelectContent>{targets.map((p) => <SelectItem key={p.id} value={p.id}>{p.id === plan.id ? `${p.name} (refresh to current catalog)` : p.name}</SelectItem>)}</SelectContent></Select></div>
      {!to ? <p className="text-sm text-muted-foreground">Choose a target to preview per-customer differences.</p> : q.isLoading ? <ListSkeleton /> : q.isError ? <p role="alert" className="text-sm text-destructive" data-testid="text-migration-error">{(q.error as Error)?.message || 'Preview unavailable'}. <button type="button" className="underline" onClick={() => q.refetch()}>Retry</button></p> : subs.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="empty-subscribers">No subscriptions on this plan.</p> : (
        <div className="space-y-2">
          {subs.map((s) => (
            <label key={s.tenantId} className="flex gap-3 rounded-sm border p-3 text-sm" data-testid={`row-subscriber-${s.tenantId}`}>
              <Checkbox checked={sel.has(s.tenantId)} onCheckedChange={() => toggle(s.tenantId)} data-testid={`checkbox-subscriber-${s.tenantId}`} />
              <span className="min-w-0 flex-1"><span className="font-medium">{s.tenantName}</span> {s.frozen ? <Pill>Contract frozen</Pill> : <Pill tone="warn">No frozen contract</Pill>} {s.priceChanged && <Pill tone="warn">Price changes</Pill>}
                <span className="block text-xs text-muted-foreground">Current: {s.currentPrices ? `${v(s.currentPrices.monthlyPrice)} / mo, ${v(s.currentPrices.yearlyPrice)} / yr, ${v(s.currentPrices.setupFee)} setup ${s.currentPrices.currency}` : 'unknown'}; published target: {q.data ? `${v(q.data.target.prices.monthlyPrice)} / mo, ${v(q.data.target.prices.yearlyPrice)} / yr` : ''}</span>
                {s.entitlementChanges.length > 0 ? <span className="block font-mono text-[11px]">{s.entitlementChanges.map((d) => `${d.key}: ${v(d.current)} to ${v(d.target)}`).join('; ')}</span> : <span className="block text-xs text-muted-foreground">No entitlement changes</span>}</span>
            </label>))}
          <Button disabled={sel.size === 0} onClick={() => { setErr(null); setReason(''); setOpen(true); }} data-testid="button-migrate">Move {sel.size} selected</Button>
        </div>)}
      <ReviewDialog open={open} onClose={() => setOpen(false)} title="move subscriptions" destructive applyLabel="Move customers" pending={migrate.isPending} error={err}
        onApply={() => { if (reason.trim().length < 3) { setErr('Give a reason (3+ characters).'); return; }
          if (!q.data) return; migrate.mutate({ planId: plan.id, data: { toPlanId: to, tenantIds: [...sel], reason: reason.trim(), confirmed: true, previewToken: q.data.previewToken } }, { onSuccess: (r) => { setOpen(false); setSel(new Set()); toast({ title: `${r.moved.length} subscriptions moved` }); }, onError: (e) => { setErr(`${(e as Error).message}`); q.refetch(); } }); }}
        rows={[['From', plan.name], ['To', q.data?.target.name ?? ''], ['Customers', String(sel.size)], ['Published revision', q.data?.publishedRevision.slice(0, 12) ?? ''], ['Effect', 'New contract frozen from the published target; audited per customer. A changed preview is refused.'], ['Reason', <Input key="r" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-migration-reason" />]]} />
    </Panel>
  );
}
