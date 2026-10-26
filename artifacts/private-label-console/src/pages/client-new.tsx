import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useCreateTenant, useListPlans, type Tenant } from '@workspace/api-client-react';
import { PageHeader } from '@/components/app/bits';
import { BrandSection, DomainSection, ModulesSection, AssetsSection, ConfigSection } from '@/components/app/sections';
import { SubscriptionSections } from '@/components/app/subscription';
import { WebsiteSection } from '@/components/app/advanced';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/app/bits';
// from '@/components/ui/label';
import { useCan } from '@/lib/principal';
import { useInvalidateTenant } from '@/lib/invalidate';
import { useGetTenant, getGetTenantQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

const steps = ['Create client', 'Plan, products, add-ons, limits', 'Brand', 'Website', 'Domain', 'Assets and networks', 'Configuration'];
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function Wizard({ initial }: { initial: Tenant }) {
  const [step, setStep] = useState(1);
  const [, nav] = useLocation();
  const q = useGetTenant(initial.id, { query: { enabled: true, queryKey: getGetTenantQueryKey(initial.id), initialData: initial } });
  const t = q.data ?? initial;
  const next = () => (step === 6 ? nav(`/clients/${t.id}`) : setStep(step + 1));
  const common = { tenant: t, onSaved: next, saveLabel: step === 6 ? 'Save and finish' : 'Save and continue' };
  return (
    <div className="space-y-4">
      {step > 2 && step < 6 && <button className="text-sm text-muted-foreground hover:text-foreground" onClick={next} data-testid="button-skip">Skip this step</button>}
      {step === 1 && (<>
        <SubscriptionSections tenantId={t.id} canManage />
        <ModulesSection {...common} saveLabel="Continue to brand" />
      </>)}
      {step === 2 && <BrandSection {...common} />}
      {step === 3 && <WebsiteSection {...common} />}
      {step === 4 && <DomainSection {...common} />}
      {step === 5 && <AssetsSection {...common} />}
      {step === 6 && <ConfigSection {...common} />}
      {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)} data-testid="button-back">Back</Button>}
    </div>
  );
}

export default function ClientNew() {
  const can = useCan();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<Tenant | null>(null);
  const [planId, setPlanId] = useState('');
  const [prepareTrial, setPrepareTrial] = useState(false);
  const plans = useListPlans();
  const enabled = (plans.data ?? []).filter((p) => p.status === 'enabled').sort((a, b) => a.displayOrder - b.displayOrder);
  const m = useCreateTenant();
  const inv = useInvalidateTenant();
  const { toast } = useToast();
  const s = touched ? slug : slugify(name);
  const valid = name.trim().length >= 2 && s.length >= 2 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && !!planId;
  if (!can.createClients) return (<><PageHeader eyebrow="Tenants" title="New client" /><p className="text-sm text-muted-foreground" data-testid="text-forbidden">Only a super admin can create clients. <Link href="/clients" className="text-copper underline">Back to clients</Link></p></>);
  return (
    <>
      <PageHeader eyebrow="White Label Core provisioning" title="New client" />
      <ol className="mb-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-wider">
        {steps.map((l, i) => <li key={l} className={i === 0 ? (created ? 'text-muted-foreground line-through' : 'text-copper') : created ? 'text-muted-foreground' : 'text-muted-foreground/60'}>0{i + 1} {l}</li>)}
      </ol>
      <div className="max-w-3xl">
        {created ? <Wizard initial={created} /> : (
          <form className="space-y-4 rounded-md border bg-card p-5" onSubmit={(e) => { e.preventDefault(); m.mutate({ data: { name: name.trim(), slug: s, planId, prepareTrial } }, { onSuccess: (t) => { inv(); setCreated(t); }, onError: (er) => toast({ title: 'Could not create client', description: (er as Error).message, variant: 'destructive' }) }); }}>
            <div className="space-y-1.5"><Label>Client name</Label><Input data-testid="input-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Slug</Label><Input data-testid="input-slug" className="font-mono" value={s} onChange={(e) => { setTouched(true); setSlug(e.target.value); }} />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers and hyphens.</p></div>
            <div className="space-y-1.5"><Label>Plan</Label>
              {plans.isLoading ? <Skeleton className="h-9" /> : plans.isError ? <ErrorState what="plans" onRetry={() => plans.refetch()} /> : enabled.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-no-plans">No enabled plans. <Link href="/plans" className="text-copper underline">Enable or create a plan</Link> first.</p> : (
                <Select value={planId} onValueChange={setPlanId}><SelectTrigger data-testid="select-plan"><SelectValue placeholder="Select an enabled plan" /></SelectTrigger>
                  <SelectContent>{enabled.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>)}</div>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={prepareTrial} onChange={e => setPrepareTrial(e.target.checked)} />Prepare for a free trial instead of assigning a billing agreement</label>
            {prepareTrial && <p className="text-sm text-muted-foreground">Creates an unassigned draft. On the next step, select and review a published trial offer. The plan above is not assigned and access remains disabled until the trial starts. No payment or delivery is activated.</p>}
            <div className="flex justify-end"><Button data-testid="button-create" disabled={!valid || m.isPending}>{m.isPending ? 'Creating' : 'Create draft client'}</Button></div>
          </form>)}
      </div>
    </>
  );
}
