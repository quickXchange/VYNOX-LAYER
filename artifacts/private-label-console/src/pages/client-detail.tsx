import { useEffect, useRef, useState } from 'react';
import { OwnerReviewProvider, useReviewGate } from '@/components/super-admin/review-gate';
import { useParams, Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TenantActivity } from '@/components/super-admin/audit-list';
import { useGetTenant, getGetTenantQueryKey, getListWhiteLabelRequestsQueryKey, useActivateTenant } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PageHeader, ErrorState, ListSkeleton, StatusBadge, stepLabel } from '@/components/app/bits';
import { BrandSection, DomainSection, ModulesSection, AssetsSection, ConfigSection } from '@/components/app/sections';
import { SubscriptionSections, useSubscription } from '@/components/app/subscription';
import { WebsiteSection, ResourcesSection } from '@/components/app/advanced';
import { DomainOwnershipSection, StaffAccessSection, ProductSettingsSection, AdministratorsSection } from '@/components/app/management';
import { PreviewIntegrations } from '@/components/exchange/preview-integrations';
import { Button } from '@/components/ui/button';
import { useCan, type Permission } from '@/lib/principal';
import { useInvalidateTenant } from '@/lib/invalidate';
import { useToast } from '@/hooks/use-toast';
import { WebsitePreviewAction } from '@/components/app/website-preview-action';
import { TenantReleases } from '@/components/app/tenant-releases';

function Group({ title, note, open, children }: { title: string; note: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-md border bg-card/50" data-testid={`group-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 px-5 py-4 marker:hidden [&::-webkit-details-marker]:hidden">
        <span><span className="font-display text-xl">{title}</span><span className="block text-xs text-muted-foreground">{note}</span></span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-copper group-open:hidden">Expand</span>
        <span className="hidden font-mono text-[11px] uppercase tracking-wider text-muted-foreground group-open:inline">Collapse</span>
      </summary>
      <div className="space-y-6 border-t p-4">{children}</div>
    </details>
  );
}

export default function ClientDetail() { return <OwnerReviewProvider><ClientDetailInner /></OwnerReviewProvider>; }

function ClientDetailInner() {
  const gate = useReviewGate();
  const qc = useQueryClient();
  const { id = '' } = useParams<{ id: string }>();
  const q = useGetTenant(id, { query: { enabled: !!id, queryKey: getGetTenantQueryKey(id) } });
  const can = useCan(id);
  const inv = useInvalidateTenant();
  const { toast } = useToast();
  const act = useActivateTenant();
  const t = q.data;
  const [tab, setTab] = useState(() => { const v = new URLSearchParams(window.location.search).get('tab'); return ['account', 'config', 'plans', 'entitlements', 'activity'].includes(v ?? '') ? v! : 'account'; });
  const tabsScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = tabsScroll.current;
    if (!container) return;
    const revealSelected = () => {
      const active = container.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) return;
      const a = active.getBoundingClientRect(), c = container.getBoundingClientRect();
      container.scrollLeft += Math.max(0, a.right - c.right) + Math.min(0, a.left - c.left);
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tab, t?.id]);
  const subQ = useSubscription(id);
  const sub = subQ.data;
  const isSuper = can.role === 'super_admin';
  const suspended = t?.status === 'suspended' || sub?.status === 'suspended';
  const unassigned = sub?.status === 'unassigned';
  const base = suspended || unassigned || !sub || subQ.isLoading;
  const roFor = (p: Permission) => base || !can.has(p);
  const ro = base || !can.editTenant;
  const F = sub?.features ?? {};
  const mods = sub?.enabledModules ?? t?.enabledModules ?? [];
  const showFn = isSuper || F.crypto_exchange === true || F.crypto_payments === true;
  const allowed = { staff: Number(sub?.limits.max_staff ?? 0) > 0, api_keys: F.api_keys === true, webhooks: F.webhooks === true, payment_methods: F.crypto_payments === true };
  return (
    <>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back"><ArrowLeft className="h-4 w-4" /> Clients</Link>
      {q.isLoading ? <ListSkeleton /> : q.isError || !t ? <ErrorState what="this client" onRetry={() => q.refetch()} /> : (
        <>
          <PageHeader eyebrow={`${t.slug} · sandbox`} title={t.brandName}>
            <StatusBadge status={t.status} />
            {can.editTenant && t.status === 'draft' && !suspended && (
              <Button data-testid="button-activate" disabled={!t.configurationComplete || act.isPending}
                onClick={() => gate('Activate sandbox', () => act.mutate({ tenantId: t.id }, { onSuccess: () => { inv(t.id); qc.invalidateQueries({ queryKey: getListWhiteLabelRequestsQueryKey() }); toast({ title: 'Activated in sandbox', description: 'If this was linked to an approved standard order, it was delivered to the customer automatically. Custom designs require the order to be marked Ready.' }); }, onError: (e) => toast({ title: 'Activation or delivery failed', description: (e as Error).message, variant: 'destructive' }) }), [['Project', t.brandName], ['Configuration', 'complete'], ['Effect', 'Sandbox activation; a linked approved standard order is delivered automatically']])}>
                {act.isPending ? 'Activating' : 'Activate sandbox'}
              </Button>)}
          </PageHeader>
          {isSuper && import.meta.env.DEV && t.environment === "sandbox" && ["draft", "active"].includes(t.status) && (
            <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-4" data-testid="panel-customer-website">
              <div><h2 className="font-display text-lg">Customer-facing website</h2>
                <p className="text-sm text-muted-foreground">View this tenant’s shared Exchange website privately. No activation or delivery is required. Your authenticated operator session is required; preview access expires after 15 minutes.</p>
              </div>
              <WebsitePreviewAction tenantId={t.id} />
            </section>
          )}
          <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-4">
            {[['Client', t.name], ['Step', stepLabel(t.provisioningStep)], ['Environment', t.environment], ['Configuration', t.configurationComplete ? 'complete' : 'incomplete']].map(([l, v]) => (
              <div key={l} className="bg-card p-4"><p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{l}</p><p className="mt-1 text-sm capitalize">{v}</p></div>))}
          </div>
          {showFn && <Link href={`/clients/${t.id}/exchange`} className="mb-6 block rounded-md border bg-card p-4 text-sm hover:bg-muted/50" data-testid="link-exchange-panel">Open exchange panel: orders, assets, routes, pricing and settings for this tenant</Link>}
          {showFn && <Link href={`/clients/${t.id}/integrations`} className="mb-6 block rounded-md border bg-card p-4 text-sm hover:bg-muted/50" data-testid="link-tenant-integrations">Integrations: provider settings, credentials and health for this tenant</Link>}
           {!!t.activationBlockers?.length && <section className="mb-6 space-y-3 rounded-md border border-copper/40 bg-copper/5 p-4" data-testid="panel-activation-blockers">
             <h2 className="font-display text-lg">Finish Exchange setup before activation</h2>
             <ul className="list-disc space-y-1 pl-5 text-sm">{t.activationBlockers.map(message => <li key={message}>{message}</li>)}</ul>
             <div className="flex flex-wrap gap-4 text-sm">
               <Link href={`/clients/${t.id}/exchange/assets`} className="text-copper hover:underline">Exchange assets</Link>
               <Link href={`/clients/${t.id}/exchange/networks`} className="text-copper hover:underline">Networks</Link>
               <Link href={`/clients/${t.id}/exchange/routes`} className="text-copper hover:underline">Routes</Link>
               <Link href={`/clients/${t.id}/exchange/pricing`} className="text-copper hover:underline">Pricing</Link>
               <Link href={`/clients/${t.id}/exchange/settings`} className="text-copper hover:underline">Settings</Link>
             </div>
             <p className="text-xs text-muted-foreground">Optional API, Webhooks and RPC previews are not required for activation.</p>
           </section>}
           {!t.configurationComplete && !t.activationBlockers?.length && <p className="mb-6 text-sm text-muted-foreground">Complete every section below before sandbox activation is available.</p>}
          {unassigned && !suspended && <p className="mb-6 text-sm text-muted-foreground">No plan is assigned, so configuration is read-only.</p>}
          {suspended && <p className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="text-suspended">This client is suspended. {isSuper ? 'All configuration is read-only; only subscription controls stay editable. Unsuspend to resume changes.' : 'Configuration is read-only until your operator lifts the suspension.'}</p>}
          {!can.editTenant && <p className="mb-6 text-sm text-muted-foreground">{can.permissions.length ? 'You can edit only the sections granted to you; everything else is read-only.' : 'Your role has read-only access to this client.'}</p>}
          <Tabs value={tab} onValueChange={setTab}>
            <div ref={tabsScroll} className="mb-5 overflow-x-auto"><TabsList className="w-max">
              {[['account', 'Account'], ['config', 'White Label config'], ['plans', 'Plans & Add-ons'], ['entitlements', 'Entitlements & Overrides'], ['activity', 'Activity']].map(([v, l]) => <TabsTrigger key={v} value={v} data-testid={`tab-client-${v}`}>{l}</TabsTrigger>)}
            </TabsList></div>
            <TabsContent value="account" className="space-y-6">
              {(isSuper || can.role === 'client_admin') && <AdministratorsSection tenantId={t.id} canManage={isSuper} />}
              <StaffAccessSection tenantId={t.id} canEdit={can.manageStaffGrants && !suspended} />
              <SubscriptionSections tenantId={t.id} canManage={can.manageSubscription} show={['suspension']} />
            </TabsContent>
            <TabsContent value="config" className="space-y-3">
              <TenantReleases tenantId={t.id} readOnly={roFor('configuration.manage') || !isSuper && can.role !== 'client_admin'} />
              <Group open title="Branding" note="Name, logo, colors, language"><BrandSection tenant={t} readOnly={roFor('branding.manage')} /></Group>
              <Group title="Domain" note="Hostname and ownership verification"><DomainSection tenant={t} readOnly={roFor('domains.manage')} /><DomainOwnershipSection tenant={t} readOnly={roFor('domains.manage')} /></Group>
              <Group title="Module and asset setup" note="Modules, assets, networks, product settings">
                {(isSuper || mods.length > 0) && <ModulesSection tenant={t} readOnly />}
                {showFn && <AssetsSection tenant={t} readOnly={roFor('configuration.manage')} />}
                {showFn && <ConfigSection tenant={t} readOnly={roFor('configuration.manage')} />}
                <ProductSettingsSection tenantId={t.id} sub={sub} readOnly={roFor('configuration.manage')} showAll={isSuper} />
              </Group>
              <Group title="Advanced previews" note="Optional API, webhook and RPC previews"><PreviewIntegrations tenantId={t.id} sub={sub} subLoading={subQ.isLoading} suspended={!!suspended} reviewSave={(apply, settings) => gate('Save optional preview settings (no live connections)', apply, [['Project', t.brandName], ['Proposed settings', <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-left text-xs">{JSON.stringify(settings, null, 2)}</pre>]])} /></Group>
              {(isSuper || F.website === true) && <Group title="Website" note="Customer-facing website settings"><WebsiteSection tenant={t} readOnly={roFor('branding.manage')} /></Group>}
              <Group title="Resources" note="Staff, API keys, webhooks, payment methods"><ResourcesSection tenantId={t.id} allowed={allowed} readOnly={roFor('resources.manage')} staffReadOnly={!can.manageStaffGrants} showAll={isSuper} /></Group>
            </TabsContent>
            <TabsContent value="plans"><SubscriptionSections tenantId={t.id} canManage={can.manageSubscription} show={['plan', 'addons', 'commercial', 'summary']} /></TabsContent>
            <TabsContent value="entitlements"><SubscriptionSections tenantId={t.id} canManage={can.manageSubscription} show={['capabilities', 'overrides']} /></TabsContent>
            <TabsContent value="activity"><TenantActivity tenantId={t.id} /></TabsContent>
          </Tabs>
        </>)}
    </>
  );
}
