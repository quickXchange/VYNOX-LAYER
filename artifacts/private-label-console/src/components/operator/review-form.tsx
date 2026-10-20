import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { applyOrderResponse } from '@/lib/order-cache';
import { useReviewWhiteLabelRequest, useListPlans, useListAddons, type WhiteLabelStatus } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState, ListSkeleton } from '@/components/app/bits';
import { TERMINAL, errMsg, statusText, cash, type WlOrder } from '@/lib/wl';
import { ReviewDialog } from '@/components/super-admin/kit';
import { validTargets } from '@/components/super-admin/lifecycle';
import { useToast } from '@/hooks/use-toast';

const price = /^\d{1,12}(\.\d{1,2})?$/;
const sel = 'h-10 w-full rounded-md border bg-background px-2 text-sm';

export function ReviewForm({ o, onDone, onReload }: { o: WlOrder; onDone: () => void; onReload: () => void }) {
  const initialVersion = useRef(String(o.updatedAt));
  const stale = initialVersion.current !== String(o.updatedAt);
  const staleMessage = 'This order changed since you opened the review. Your draft is preserved. Copy any edits you need, then load the latest order before saving.';
  const cache = useQueryClient();
  const review = useReviewWhiteLabelRequest(); const plans = useListPlans(); const addons = useListAddons();
  const { toast } = useToast();
  const [status, setStatus] = useState<string>(o.status);
  const [m, setM] = useState(o.monthlyPrice ?? ''); const [s, setS] = useState(o.setupPrice ?? ''); const [cur, setCur] = useState(o.currency ?? 'USD');
  const [cust, setCust] = useState(o.customizationPrice ?? ''); const [dec, setDec] = useState<'pending' | 'approved' | 'rejected'>(o.customDesignDecision ?? 'pending');
  const [pid, setPid] = useState(o.approvedPlan?.id ?? o.requestedPlan?.id ?? ''); const [aids, setAids] = useState<string[]>((o.approvedAddons ?? o.requestedAddons ?? []).map((a) => a.id));
  const [err, setErr] = useState<string | null>(null);
  const [pendingSt, setPendingSt] = useState<string | null>(null);
  const ro = TERMINAL.includes(o.status); const custom = o.design?.type === 'custom';
  const curRef = useRef(cur); curRef.current = cur;
  const okP = (v: string) => v === '' || price.test(v);
  const formErr = !okP(m) ? 'Recurring price format is 0.00' : !okP(s) ? 'Setup price format is 0.00' : !okP(cust) ? 'Customization price format is 0.00' : !/^[A-Za-z]{3}$/.test(cur) ? 'Currency must be a 3-letter ISO code' : '';
  const planCur = (plans.data ?? []).find((p) => p.id === pid)?.currency;
  const canApprove = !!pid && price.test(m) && price.test(s) && (!custom || (price.test(cust) && dec === 'approved'));
  const addonList = (addons.data ?? []).filter((a) => a.enabled || aids.includes(a.id)).filter((a) => { const c = a.currency; return !planCur || !c || c === planCur; });
  const save = (st: string) => {
    if (stale || review.isPending) { if (stale) setErr(staleMessage); return; }
    setErr(null);
    const need = st === 'approved' && !canApprove;
    if (need) { setErr('Approval needs an Exchange plan, recurring and setup prices, and—for custom designs—an approved decision and customization price.'); return; }
    setPendingSt(st);
  };
  const apply = (st: string) => {
    if (stale || review.isPending) { if (stale) setErr(staleMessage); return; }
    review.mutate({ requestId: o.id, data: { status: st as WhiteLabelStatus, monthlyPrice: m === '' ? null : m, setupPrice: s === '' ? null : s, currency: cur.toUpperCase(), operatorNote: '', customizationPrice: cust === '' ? null : cust, approvedPlanId: pid || null, approvedAddonIds: aids, customDesignDecision: dec } }, { onSuccess: async (response) => { applyOrderResponse(cache, o.id, response); setPendingSt(null); await onDone(); toast({ title: 'Order review saved' }); }, onError: (e) => { setErr(errMsg(e)); toast({ title: 'Review failed', description: errMsg(e), variant: 'destructive' }); } });
  };
  if (ro) return <p className="text-sm text-muted-foreground">This order is {statusText(o.status)}. Status and prices are read-only; notes can still be added.</p>;
  if (plans.isLoading || addons.isLoading) return <div role="status" aria-label="Loading review options"><ListSkeleton rows={3} /></div>;
  if (plans.isError || addons.isError) return <ErrorState what="review options" onRetry={() => { plans.refetch(); addons.refetch(); }} />;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(status); }} className="space-y-4">
      {stale && <div role="alert" className="space-y-2 rounded-md border p-3 text-sm"><p>{staleMessage}</p><Button type="button" variant="outline" disabled={review.isPending} onClick={onReload}>Discard draft and load latest order</Button></div>}
      <fieldset disabled={stale || review.isPending} className="space-y-4">
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 [&>label]:block [&>label]:min-w-0 [&>label]:space-y-1.5 [&_select]:w-full">
        <label className="text-sm md:col-span-2">Status<select data-testid="select-status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>{[o.status, ...validTargets(o.status)].map((x) => <option key={x} value={x}>{statusText(x)}</option>)}</select></label>
        <label className="text-sm">Currency<Input data-testid="input-currency" value={cur} maxLength={3} onChange={(e) => setCur(e.target.value.toUpperCase())} /></label>
         <label className="text-sm">Recurring / {o.billingPeriod === 'yearly' ? 'year' : 'month'}<Input data-testid="input-monthly" inputMode="decimal" value={m} onChange={(e) => setM(e.target.value)} placeholder="0.00" /></label>
         <label className="text-sm">Setup fee<Input data-testid="input-setup" inputMode="decimal" value={s} onChange={(e) => setS(e.target.value)} placeholder="0.00" /></label>
         <label className="text-sm">Customization fee<Input data-testid="input-customization" inputMode="decimal" value={cust} onChange={(e) => setCust(e.target.value)} placeholder="Not quoted" /></label>
        {custom && <label className="text-sm">Custom design<select className={sel} value={dec} onChange={(e) => setDec(e.target.value as typeof dec)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>}
        <label className="text-sm md:col-span-2">Approved plan<select data-testid="select-plan" className={sel} value={pid} onChange={(e) => { setPid(e.target.value); setAids([]); const pc = (plans.data ?? []).find((p) => p.id === e.target.value)?.currency; if (pc) setCur(pc); }}><option value="">None</option>{(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{o.requestedPlan?.id === p.id ? ' (requested)' : ''}</option>)}</select></label>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-1 text-sm">Approved add-ons</legend>
        {addonList.length === 0 && <p className="text-sm text-muted-foreground">No add-ons in this currency.</p>}
        {addonList.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><Checkbox checked={aids.includes(a.id)} onCheckedChange={(v) => setAids(v ? [...aids, a.id] : aids.filter((x) => x !== a.id))} />{a.name}</label>)}</fieldset>
      {(err || formErr) && <p role="alert" data-testid="text-error" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{err ?? formErr}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" data-testid="button-save-review" disabled={!!formErr || review.isPending || (status === 'approved' && !canApprove)}>Save review, pricing and status</Button>
        {validTargets(o.status).includes('approved') && <Button type="button" variant="secondary" data-testid="button-approve" disabled={!!formErr || !canApprove || review.isPending} onClick={() => { setStatus('approved'); save('approved'); }}>Approve</Button>}
        {validTargets(o.status).includes('rejected') && <Button type="button" variant="outline" data-testid="button-reject" disabled={!!formErr || review.isPending} onClick={() => { setStatus('rejected'); save('rejected'); }}>Reject</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Approval creates a linked sandbox draft only. Activate Sandbox and Mark Ready are separate steps and neither delivers. Customer access is granted only by the explicit Deliver action on a Ready order.</p>
      </fieldset>
      <ReviewDialog open={!!pendingSt} onClose={() => setPendingSt(null)} title="order review" pending={review.isPending} error={stale ? staleMessage : err} destructive={pendingSt === 'rejected'}
        applyLabel="Confirm and apply" onApply={() => pendingSt && apply(pendingSt)}
        rows={[['Status', `${statusText(o.status)} to ${statusText(pendingSt ?? status)}`], ['Plan', (plans.data ?? []).find((p) => p.id === pid)?.name ?? 'None'], ['Add-ons', aids.length ? String(aids.length) : 'None'], ['Recurring', cash(m, cur)], ['Setup fee', cash(s, cur)], ['Customization', cash(cust, cur)]]} />
    </form>
  );
}
