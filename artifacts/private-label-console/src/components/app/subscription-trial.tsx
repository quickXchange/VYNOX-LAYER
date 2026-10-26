import { useState } from 'react';
import { useGetPricingPublication, getGetPricingPublicationQueryKey, useStartTenantTrial, useUpdateTenantTrial, type SubscriptionView, type Plan } from '@workspace/api-client-react';
import { useGatedMutate } from '@/components/super-admin/review-gate';
import { useInvalidateTenant } from '@/lib/invalidate';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCan } from '@/lib/principal';

export function SubscriptionTrial({ sub, canManage }: { sub: SubscriptionView; canManage: boolean }) {
  const can = useCan(sub.tenantId);
  const publication = useGetPricingPublication({ query: { queryKey: getGetPricingPublicationQueryKey(), enabled: canManage && !sub.plan, staleTime: 0 } });
  const start = useStartTenantTrial();
  const update = useUpdateTenantTrial();
  const gatedStart = useGatedMutate(start.mutate, 'Start a free trial');
  const gatedUpdate = useGatedMutate(update.mutate, 'Update trial');
  const invalidate = useInvalidateTenant();
  const { toast } = useToast();
  const [planId, setPlanId] = useState('');
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [reason, setReason] = useState('');
  // Stable across retries; server binds this key to plan, publication and period.
  const [key] = useState(() => crypto.randomUUID());
  const publishedPlans = publication.data?.published?.plans;
  const plans = (Array.isArray(publishedPlans) ? publishedPlans as (Plan & { billingPeriods: string[] })[] : []).filter(p => (p.profile?.trialDays ?? 0) > 0);
  const selected = plans.find(p => p.id === planId);
  const trial = sub.trial;
  const options = {
    onSuccess: () => { invalidate(sub.tenantId); setReason(''); toast({ title: 'Trial updated', description: 'No payment collected. Financial holds are unchanged.' }); },
    onError: (e: Error) => toast({ title: 'Trial action failed', description: e.message, variant: 'destructive' as const }),
  };
  const action = (action: 'cancel' | 'request_renewal') => {
    if (!trial) return;
    const args = { tenantId: sub.tenantId, data: { trialId: trial.id, action, reason: reason.trim() } };
    if (canManage) gatedUpdate(args, options);
    else update.mutate(args, options);
  };
  if (!trial && (!canManage || sub.plan)) return null;
  return <section className="space-y-3 rounded-md border p-4" data-testid="subscription-trial">
    <h3 className="font-medium">Free trial</h3>
    <p className="text-sm text-muted-foreground">No automatic renewal or charge. Trial access ends at the deadline. Continuing requires a separately reviewed agreement; a renewal request does not extend access. Existing financial and delivery holds remain in place.</p>
    {trial ? <>
      <dl className="text-sm space-y-1">
        <div>Status: <strong>{trial.state}</strong></div>
        <div>Started: {new Date(trial.startedAt).toLocaleString()}</div>
        <div>Access ends: {new Date(trial.endsAt).toLocaleString()}</div>
        <div>Agreed recurring price: {sub.currency} {sub.recurringEstimate ?? 'Not configured'} / {sub.billingPeriod} — not charged automatically</div>
        <div>Setup fee after trial: {sub.currency} {sub.plan?.setupFee ?? 'Not configured'} — subject to separate approval</div>
        {trial.renewalRequestedAt && <div>Renewal review requested: {new Date(trial.renewalRequestedAt).toLocaleString()}. No renewal approved.</div>}
      </dl>
      {trial.state !== 'cancelled' && (canManage || can.role === 'client_admin') && <>
        <Input aria-label="Trial change reason" placeholder="Reason (required)" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {trial.state === 'active' && <Button variant="destructive" disabled={reason.trim().length < 2 || update.isPending} onClick={() => action('cancel')}>Cancel trial now</Button>}
          <Button variant="outline" disabled={!!trial.renewalRequestedAt || reason.trim().length < 2 || update.isPending} onClick={() => action('request_renewal')}>Request renewal review</Button>
        </div>
        <p className="text-xs text-muted-foreground">Cancellation ends trial access immediately and retains your data.</p>
      </>}
    </> : <>
      {publication.isLoading ? <p>Loading published trial offers…</p> : publication.isError ? <p role="alert">Could not load published terms. <button onClick={() => publication.refetch()}>Retry</button></p> : !plans.length ? <p>No published trial offers. Configure trial days on a paid plan, then publish it.</p> : <>
        <label className="block text-sm">Published trial offer
          <select className="mt-1 block w-full rounded border bg-background p-2" value={planId} onChange={e => setPlanId(e.target.value)}>
            <option value="">Select an offer</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.profile?.trialDays} days</option>)}
          </select>
        </label>
        <label className="block text-sm">Future billing period
          <select className="ml-2 rounded border bg-background p-2" value={period} onChange={e => setPeriod(e.target.value as 'monthly' | 'yearly')}>
            <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
        </label>
        {selected && <p className="text-sm">Published recurring amount: {selected.currency} {period === 'monthly' ? selected.monthlyPrice : selected.yearlyPrice}; setup: {selected.setupFee}. Published discounts are frozen with this agreement. Due during trial: 0. No invoice is created.</p>}
        <Input aria-label="Trial start reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Reason for starting trial (required)" />
        <Button disabled={!selected || !selected.billingPeriods.includes(period) || !publication.data?.publishedRevision || reason.trim().length < 2 || start.isPending} onClick={() => gatedStart({
          tenantId: sub.tenantId, data: { planId, billingPeriod: period, publishedRevision: publication.data!.publishedRevision!, idempotencyKey: key, reason: reason.trim() },
        }, options)}>Start free trial</Button>
      </>}
    </>}
  </section>;
}
