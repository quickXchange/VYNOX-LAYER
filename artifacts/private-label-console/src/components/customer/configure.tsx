import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useGetWhiteLabelCatalog, useSubmitWhiteLabelRequest, getListMyWhiteLabelRequestsQueryKey, type ExchangeAction } from '@workspace/api-client-react';
import { PageHeader } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { errMsg, orderRef, type WlOrder } from '@/lib/wl';
import { STEPS, initialCfg, stepError, type Cfg } from './configure-state';
import { ProjectStep, DesignStep } from './step-project-design';
import { planPeriods } from './plan-bits';
import { FeaturesStep, PlanStep, AddonsStep } from './step-plan-addons';
import { RequirementsStep, ReviewStep } from './step-requirements-review';

export function ConfigureExchange() {
  const qc = useQueryClient(); const submit = useSubmitWhiteLabelRequest();
  const catQ = useGetWhiteLabelCatalog({ query: { refetchInterval: 5000, refetchOnWindowFocus: true, staleTime: 0 } as never });
  const cat = catQ;
  const [cfg, setCfg] = useState<Cfg>(initialCfg()); const [step, setStep] = useState(0); const [maxStep, setMax] = useState(0);
  const [busy, setBusy] = useState(0); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<WlOrder | null>(null);
  const key = useRef(crypto.randomUUID());
  const intendedPlanApplied = useRef(false);
  useEffect(() => {
    if (!cat.data || intendedPlanApplied.current) return;
    intendedPlanApplied.current = true;
    let intended = new URLSearchParams(window.location.search).get('selectedPlanId');
    try { intended ||= sessionStorage.getItem('vynox-intended-plan'); sessionStorage.removeItem('vynox-intended-plan'); } catch { /* storage optional */ }
    const plan = cat.data.plans.find(p => p.id === intended);
    if (plan) setCfg(c => ({ ...c, planId: plan.id, period: planPeriods(plan)[0] ?? c.period }));
  }, [cat.data]);
  const set = (p: Partial<Cfg> | ((c: Cfg) => Partial<Cfg>)) => { setErr(null); setCfg((c) => ({ ...c, ...(typeof p === 'function' ? p(c) : p) })); };
  const onBusy = (d: number) => setBusy((b) => b + d);
  const selPlan = cat.data?.plans.find((x) => x.id === cfg.planId); const avail = planPeriods(selPlan);
  const noPeriods = !!cfg.planId && !cat.isLoading && (!selPlan || avail.length === 0);
  const periodErr = noPeriods ? 'The selected plan has no billing period available right now. Choose another plan.' : null;
  useEffect(() => { if (selPlan && avail.length > 0 && !avail.includes(cfg.period)) setCfg((c) => ({ ...c, period: avail[0] })); }, [selPlan, avail.join(','), cfg.period]); // eslint-disable-line react-hooks/exhaustive-deps
  const problem = stepError(step, cfg) ?? ((step === 3 || step === 6) ? periodErr : null);
  const go = (i: number) => { setStep(i); setMax((m) => Math.max(m, i)); };
  const send = () => {
    setErr(null); const c = cfg; const custom = c.designType === 'custom';
    submit.mutate({ data: {
      projectName: c.brandName.trim(), brandName: c.brandName.trim(), preferredDomain: c.domain.trim(), actions: c.acts as ExchangeAction[], details: c.details, idempotencyKey: key.current,
      design: { type: c.designType, styleName: custom ? c.styleName.trim() : '', primaryColor: c.primary, accentColor: c.accent, themePreference: c.theme, description: custom ? c.description : '', referenceWebsiteUrl: custom && c.refUrl.trim() ? c.refUrl.trim() : null, notes: custom ? c.notes : '', logoAttachmentId: c.logo?.id ?? null, faviconAttachmentId: null, referenceAttachmentIds: custom ? c.refs.map((x) => x.id) : [] },
      requestedPlanId: c.planId, requestedAddonIds: c.addonIds, billingPeriod: c.period, attachmentIds: c.reqFiles.map((x) => x.id),
    } }, {
      onSuccess: (r) => { setDone(r); key.current = crypto.randomUUID(); qc.invalidateQueries({ queryKey: getListMyWhiteLabelRequestsQueryKey() }); },
      onError: (e) => setErr(errMsg(e)),
    });
  };
  if (done) return (
    <><PageHeader eyebrow="White label" title="Request submitted" />
      <div className="max-w-xl space-y-3 rounded-md border bg-card p-6" data-testid="text-submitted">
        <p className="font-mono text-sm uppercase tracking-wider text-copper">{orderRef(done)}</p>
        <p className="font-display text-3xl">We have your request.</p>
        <p className="text-sm text-muted-foreground">A Super Admin will review your configuration. You are not charged and nothing is implemented until the order is approved.</p>
        <div className="flex flex-wrap gap-2"><Button asChild><Link href={`/account/orders/${done.id}`}>View order {orderRef(done)}</Link></Button><Button asChild variant="outline"><Link href="/account/orders">My Orders</Link></Button></div>
      </div></>
  );
  const last = step === STEPS.length - 1;
  return (
    <>
      <PageHeader eyebrow="White label" title="Configure Exchange" />
      <ol className="mb-8 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 xl:flex xl:gap-1" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-0 flex-1"><button type="button" disabled={i > maxStep || busy > 0} aria-current={i === step ? 'step' : undefined} onClick={() => go(i)} data-testid={`step-${s.toLowerCase()}`}
            className={`flex w-full items-center gap-2 border-b-2 px-1 pb-2 text-left text-sm ${i === step ? 'border-primary' : i < step ? 'border-copper' : 'border-border text-muted-foreground'}`}>
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[10px] ${i < step ? 'bg-copper text-primary-foreground' : ''}`}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>{s}</button></li>))}
      </ol>
      <form onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        if (last && submitter?.getAttribute('data-testid') === 'button-submit' && !submit.isPending && busy === 0 && !noPeriods &&
          ![0, 1, 2, 3, 5].some((i) => stepError(i, cfg))) send();
      }} className="max-w-3xl space-y-6">
        <h2 className="font-display text-3xl">{STEPS[step]}</h2>
        {step === 0 && <ProjectStep cfg={cfg} set={set} onBusy={onBusy} />}
        {step === 1 && <DesignStep cfg={cfg} set={set} onBusy={onBusy} />}
        {step === 2 && <FeaturesStep cfg={cfg} set={set} onBusy={onBusy} />}
        {step === 3 && <PlanStep cfg={cfg} set={set} onBusy={onBusy} cat={cat} />}
        {step === 4 && <AddonsStep cfg={cfg} set={set} onBusy={onBusy} cat={cat} />}
        {step === 5 && <RequirementsStep cfg={cfg} set={set} onBusy={onBusy} />}
        {step === 6 && <ReviewStep cfg={cfg} cat={cat.data} />}
        {err && <p role="alert" data-testid="text-error" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{err}</p>}
        {busy > 0 && <p className="text-sm text-muted-foreground">Uploading files. Please wait.</p>}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" variant="ghost" disabled={step === 0 || submit.isPending} onClick={() => go(step - 1)}>Back</Button>
          {problem && <span className="text-sm text-destructive">{problem}</span>}
          <div className="ml-auto">
            {last ? <Button key="submit-order" type="submit" data-testid="button-submit" disabled={submit.isPending || busy > 0 || noPeriods || [0, 1, 2, 3, 5].some((i) => stepError(i, cfg))}>{submit.isPending ? 'Submitting' : 'Submit White Label Request'}</Button>
              : <Button key="continue-step" type="button" data-testid="button-next" disabled={!!problem || busy > 0} onClick={() => go(step + 1)}>Continue</Button>}
          </div>
        </div>
      </form>
    </>
  );
}
