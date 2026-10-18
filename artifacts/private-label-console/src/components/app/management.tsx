import { useEffect, useRef, useState } from 'react';
import { useGatedMutate } from '@/components/super-admin/review-gate';
import {
  useGetDomainVerification, getGetDomainVerificationQueryKey, useVerifyTenantDomain, useCheckTenantDomainHosting, useManageTenantDomainHosting, useSetStaffPermissions,type DomainVerification,
  useListTenantResources, getListTenantResourcesQueryKey, useListProductRegistry, useGetProductConfiguration, getGetProductConfigurationQueryKey,
  useSetProductConfiguration, useListTenantAdministrators, getListTenantAdministratorsQueryKey, useAssignTenantAdministrator, useSetTenantAdministratorStatus, type Tenant, type SubscriptionView, type ProductModule,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useInvalidateTenant } from '@/lib/invalidate';
import { ErrorState } from './bits';
import { Section } from './sections';

const RO = <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Read only for your role</span>;

function copy(v: string, t: (a: { title: string }) => void) { void navigator.clipboard?.writeText(v).then(() => t({ title: 'Copied' })); }

export function DnsRecordList({ d }: { d: DomainVerification }) {
  const { toast } = useToast();
  const recs = d.dnsRecords ?? [];
  if (recs.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="list-dns-records">
      <p>{d.hostingProvider === 'vercel' ? 'Vercel hosting: add these exact records at your DNS provider.' : 'Add these exact records at your DNS provider.'}</p>
      {recs.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 font-mono text-xs" data-testid={`row-dns-record-${i}`}>
          <span className="uppercase text-copper">{r.type}</span><span className="break-all">{r.name}</span><span className="break-all text-muted-foreground">{r.value}</span>
          <Button size="sm" variant="ghost" onClick={() => copy(r.value, toast)} data-testid={`button-copy-dns-${i}`}>Copy value</Button>
          <span className="w-full font-sans text-muted-foreground">{r.purpose}</span>
        </div>))}
    </div>
  );
}

export function DomainOwnershipSection({ tenant, readOnly }: { tenant: Tenant; readOnly?: boolean }) {
  const q = useGetDomainVerification(tenant.id);
  const m = useVerifyTenantDomain();
  const verify = useGatedMutate(m.mutate, 'Check and record domain ownership (DNS records will not be changed)');
  const hm = useCheckTenantDomainHosting();
  const checkHosting = useGatedMutate(hm.mutate, 'Check hosting and HTTPS for the saved domain (read only)');
  const rm = useManageTenantDomainHosting();
  const qc = useQueryClient();
  const inv = useInvalidateTenant();
  const { toast } = useToast();
  const d = q.data;
  const firstDomain = useRef(true);
  useEffect(() => {
    if (firstDomain.current) { firstDomain.current = false; return; }
    qc.invalidateQueries({ queryKey: getGetDomainVerificationQueryKey(tenant.id) });
  }, [tenant.domain, tenant.id, qc]);
  return (
    <Section n="02b" title="Domain ownership" note="A TXT record proves control of the hostname. Public delivery waits for the released site, exact hostname approval, deployment binding and verified HTTPS."
      footer={readOnly ? RO : <div className="flex flex-wrap gap-2"><Button variant="outline" data-testid="button-check-hosting" disabled={!d || d.status !== 'verified' || !d.siteReleased || !d.providerManagementAvailable || !d.providerBindingVerified || hm.isPending} onClick={() => checkHosting({ tenantId: tenant.id }, { onSuccess: (r) => { qc.setQueryData(getGetDomainVerificationQueryKey(tenant.id), r); qc.invalidateQueries({ queryKey: getGetDomainVerificationQueryKey(tenant.id) }); inv(tenant.id); toast({ title: r.httpsReady ? 'HTTPS is ready' : 'Hosting not ready yet', description: r.httpsReady ? undefined : (r.hostingError ?? 'See the instructions below.') }); }, onError: (e) => toast({ title: 'Hosting check failed', description: (e as Error).message, variant: 'destructive' }) })}>{hm.isPending ? 'Checking hosting' : 'Check hosting and HTTPS'}</Button><Button data-testid="button-verify-domain" disabled={!d || d.status === 'unconfigured' || m.isPending}
        onClick={() => verify({ tenantId: tenant.id }, {
          onSuccess: (r) => { qc.setQueryData(getGetDomainVerificationQueryKey(tenant.id), r); qc.invalidateQueries({ queryKey: getGetDomainVerificationQueryKey(tenant.id) }); inv(tenant.id); toast({ title: r.status === 'verified' ? 'Domain verified' : 'TXT record not found yet', description: r.status === 'verified' ? undefined : 'DNS changes can take time to propagate.' }); },
          onError: (e) => toast({ title: 'Verification failed', description: (e as Error).message, variant: 'destructive' }),
        })}>{m.isPending ? 'Checking DNS' : 'Check DNS record'}</Button></div>}>
      {m.isError && <p role="alert" className="rounded border border-destructive/40 p-3 text-sm text-destructive" data-testid="text-dns-verification-error">{(m.error as { data?: { error?: string }; message?: string })?.data?.error ?? (m.error as Error)?.message ?? 'DNS ownership could not be verified. Check the TXT record and allow DNS propagation, then retry.'}</p>}
      {q.isLoading ? <Skeleton className="h-24" /> : q.isError || !d ? <ErrorState what="domain verification" onRetry={() => q.refetch()} /> : d.status === 'unconfigured' ? (
        <p className="text-sm text-muted-foreground" data-testid="text-domain-unconfigured">No domain is saved for this client. Save a domain above to receive a verification record.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-px overflow-hidden rounded-md border bg-border md:grid-cols-3">
            {[['Domain', d.domain ?? ''], ['Ownership', d.status], ['Site release', d.siteReleased ? 'delivered' : 'preview only'], ['Deployment binding', d.providerBindingVerified ? 'verified' : 'not verified'], ['Hosting', d.hostingConnected ? 'connected' : 'not connected']].map(([l, v]) => (
              <div key={l} className="bg-card p-3"><p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{l}</p><p className="mt-1 break-all text-sm" data-testid={`text-domain-${l.toLowerCase()}`}>{v}</p></div>))}
          </div>
          {d.txtName && d.txtValue && (
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <p>{d.status === 'verified' ? 'Ownership TXT record (keep it in place).' : 'Create this exact TXT record at the customer DNS provider, then check again.'}</p>
              <p className="font-mono text-xs"><span className="text-muted-foreground">Type </span><span>TXT</span></p>
              <p className="font-mono text-xs"><span className="text-muted-foreground">Name </span><span data-testid="text-txt-name" className="break-all">{d.txtName}</span></p>
              <p className="font-mono text-xs"><span className="text-muted-foreground">Value </span><span data-testid="text-txt-value" className="break-all">{d.txtValue}</span></p>
            </div>)}
          <div className="space-y-1 rounded-md border p-3 text-sm" data-testid="panel-hosting">
            <p>Hostname approval: <span data-testid="text-domain-approval">{d.activationApproved ? 'approved for the configured deployment' : 'not approved'}</span></p>
            <p>Approved deployment: <span className="font-mono text-xs" data-testid="text-approved-deployment">{d.approvedDeploymentId ?? 'not configured'}</span></p>
            <p>HTTPS: <span data-testid="text-https">{d.httpsReady ? 'ready' : 'not proven'}</span>{d.hostingCheckedAt && <span className="text-muted-foreground"> . checked {new Date(d.hostingCheckedAt).toLocaleString()}</span>}</p>
            {d.hostingError && <p role="alert" className="text-destructive [overflow-wrap:anywhere]" data-testid="text-hosting-error">{d.hostingError} Fix the records and check again.</p>}
            {d.httpsReady && d.websiteUrl && <p><a href={d.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-copper underline" data-testid="link-domain-website">{d.websiteUrl}</a></p>}
            {d.instructions && d.instructions.length > 0 && <ul className="list-disc space-y-1 pl-5" data-testid="list-hosting-instructions">{d.instructions.map((i) => <li key={i}>{i}</li>)}</ul>}
            <DnsRecordList d={d} />
            <p data-testid="text-provider-state">Provider registration: {d.providerRegistered ? (d.providerVerified ? 'registered and verified' : 'registered, not yet verified') : 'not registered'}{d.providerCheckedAt && <span className="text-muted-foreground"> . checked {new Date(d.providerCheckedAt).toLocaleString()}</span>}</p>
            {d.providerError && <p role="alert" className="text-destructive [overflow-wrap:anywhere]">{d.providerError}</p>}
            <Button size="sm" variant="outline" data-testid="button-refresh-provider" disabled={!d.providerManagementAvailable || rm.isPending} onClick={() => rm.mutate({ tenantId: tenant.id, data: { action: 'refresh' } }, { onSuccess: (r) => { qc.setQueryData(getGetDomainVerificationQueryKey(tenant.id), r); toast({ title: 'Provider state refreshed' }); }, onError: (e) => toast({ title: 'Refresh failed', description: (e as Error).message, variant: 'destructive' }) })}>{rm.isPending ? 'Refreshing' : 'Refresh registration state'}</Button>
            {!d.providerManagementAvailable && <p className="text-xs text-muted-foreground">Refresh is unavailable: provider management is not configured.</p>}
            <p className="text-xs text-muted-foreground">The operator approves the exact hostname and deployment, registers it, then binds the approved deployment. The customer applies only the DNS records shown above. The customer hostname stays preview-only until the final HTTPS and signed tenant-routing check passes.</p>
          </div>
        </div>)}
    </Section>
  );
}

const PERMS = [['branding.manage', 'Brand and website'], ['domains.manage', 'Domain'], ['configuration.manage', 'Assets and configuration'], ['resources.manage', 'Resources']] as const;

function StaffRow({ tenantId, id, label, reference, perms, canEdit }: { tenantId: string; id: string; label: string; reference: string | null; perms: string[]; canEdit: boolean }) {
  const m = useSetStaffPermissions();
  const gM = useGatedMutate(m.mutate, 'Save staff permissions');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sel, setSel] = useState(perms);
  const key = perms.join(',');
  useEffect(() => setSel(perms), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = [...sel].sort().join(',') !== [...perms].sort().join(',');
  return (
    <div className="space-y-2 p-3" data-testid={`row-grant-${id}`}>
      <div><p className="text-sm">{label}</p>{reference && <p className="font-mono text-[11px] text-muted-foreground">{reference}</p>}</div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {PERMS.map(([p, l]) => (
          <label key={p} className="flex items-center gap-2 text-sm"><Checkbox data-testid={`checkbox-grant-${id}-${p}`} disabled={!canEdit} checked={sel.includes(p)} onCheckedChange={() => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))} />{l}</label>))}
        {canEdit && <Button size="sm" data-testid={`button-save-grant-${id}`} disabled={!dirty || m.isPending} onClick={() => gM({ tenantId, userId: id, data: { permissions: sel as never } }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListTenantResourcesQueryKey(tenantId, 'staff') }); toast({ title: 'Permissions saved' }); },
          onError: (e) => toast({ title: 'Could not save permissions', description: (e as Error).message, variant: 'destructive' }),
        })}>{m.isPending ? 'Saving' : 'Save access'}</Button>}
      </div>
    </div>
  );
}

export function StaffAccessSection({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const q = useListTenantResources(tenantId, 'staff');
  const items = q.data ?? [];
  return (
    <Section n="R0" title="Staff access" note="Staff are read-only until granted a section. The server enforces every grant."
      footer={canEdit ? <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Super admin and client admin only</span> : RO}>
      {q.isLoading ? <Skeleton className="h-16" /> : q.isError ? <ErrorState what="staff" onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="text-no-staff">No staff to grant access to. Add staff under Staff below.</p>
      ) : <div className="divide-y rounded-md border">{items.map((s) => <StaffRow key={s.id} tenantId={tenantId} id={s.id} label={s.label} reference={s.reference} perms={s.permissions ?? []} canEdit={canEdit} />)}</div>}
    </Section>
  );
}

const SECRET = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|mnemonic|seed)/i;
function findSecret(v: unknown): string | null {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (SECRET.test(k)) return k; const r = findSecret(x); if (r) return r; }
  return null;
}

const ACTIONS = ['swap', 'convert'];
function exchangeError(p: Record<string, unknown>) {
  const extra = Object.keys(p).filter((k) => k !== 'defaultAction' && k !== 'publicNote');
  if (extra.length) return `Exchange settings accept only defaultAction and publicNote, not "${extra[0]}"`;
  if (p.defaultAction !== undefined && !ACTIONS.includes(String(p.defaultAction))) return 'defaultAction must be swap or convert';
  if (p.publicNote !== undefined && typeof p.publicNote !== 'string') return 'publicNote must be text';
  return '';
}

function ProductPanel({ tenantId, mod, readOnly }: { tenantId: string; mod: ProductModule; readOnly?: boolean }) {
  const q = useGetProductConfiguration(tenantId, mod.key);
  const m = useSetProductConfiguration();
  const gM = useGatedMutate(m.mutate, 'Save product settings');
  const qc = useQueryClient();
  const { toast } = useToast();
  const server = JSON.stringify(q.data?.configuration ?? {}, null, 2);
  const [txt, setTxt] = useState(server);
  useEffect(() => setTxt(server), [server]);
  const isEx = mod.key === 'crypto_exchange';
  let parsed: Record<string, unknown> | null = null; let err = '';
  try { const p = JSON.parse(txt || '{}'); if (!p || typeof p !== 'object' || Array.isArray(p)) err = 'Must be a JSON object'; else { parsed = p; const s = findSecret(p); const ex = isEx ? exchangeError(p) : ''; if (ex) err = ex; else if (s) err = `Key "${s}" looks like a secret. Secrets are not stored here.`; } } catch { err = 'Invalid JSON'; }
  return (
    <div className="space-y-2 p-4" data-testid={`panel-product-${mod.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-display text-xl">{mod.name}</p>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground" data-testid={`text-exec-${mod.key}`}>{mod.lifecycle === 'core_ready' ? 'core ready' : mod.lifecycle === 'sandbox_only' ? 'sandbox only' : 'deferred, no service implemented'}</span></div>
      {q.isLoading ? <Skeleton className="h-24" /> : q.isError ? <ErrorState what="product settings" onRetry={() => q.refetch()} /> : (
        <>
          {isEx && <p className="text-xs text-muted-foreground" data-testid={`text-help-${mod.key}`}>Schema: {'{ "defaultAction": "swap" | "convert", "publicNote": "text" }'}, both optional. The default action must be one the client is entitled to. Nothing is executed.</p>}
          <Textarea data-testid={`input-config-${mod.key}`} disabled={readOnly} className="min-h-28 font-mono text-xs" value={txt} onChange={(e) => setTxt(e.target.value)} />
          <div className="flex items-center gap-3">
            {readOnly ? RO : <Button size="sm" data-testid={`button-save-config-${mod.key}`} disabled={!!err || !parsed || m.isPending || txt === server} onClick={() => parsed && gM({ tenantId, moduleKey: mod.key, data: { configuration: parsed } }, {
              onSuccess: () => { qc.invalidateQueries({ queryKey: getGetProductConfigurationQueryKey(tenantId, mod.key) }); toast({ title: `${mod.name} settings saved` }); },
              onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
            })}>{m.isPending ? 'Saving' : 'Save settings'}</Button>}
            {err && !readOnly && <span className="text-sm text-destructive" data-testid={`text-config-error-${mod.key}`}>{err}</span>}
          </div>
        </>)}
    </div>
  );
}

export function ProductSettingsSection({ tenantId, sub, readOnly, showAll }: { tenantId: string; sub?: SubscriptionView; readOnly?: boolean; showAll?: boolean }) {
  const reg = useListProductRegistry();
  const on = sub?.enabledModules ?? [];
  const mods = (reg.data ?? []).filter((m) => on.includes(m.key));
  const denied = showAll ? (reg.data ?? []).filter((m) => !on.includes(m.key)) : [];
  return (
    <Section n="P1" title="Product settings" note="Inert metadata stored per product. It configures nothing at runtime and must not contain secrets."
      footer={readOnly ? RO : <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">JSON object, no secrets</span>}>
      {reg.isLoading ? <Skeleton className="h-24" /> : reg.isError ? <ErrorState what="the product registry" onRetry={() => reg.refetch()} /> : mods.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="text-no-products">No registered product is enabled for this client.</p>
      ) : <div className="divide-y rounded-md border">{mods.map((m) => m.key === 'crypto_exchange' ? <div key={m.key} className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid="panel-product-crypto_exchange"><p className="font-display text-xl">{m.name}</p><Link href={`/clients/${tenantId}/exchange/settings`} className="text-sm text-copper hover:underline" data-testid="link-exchange-dedicated">Managed in the dedicated Exchange panel</Link></div> : <ProductPanel key={m.key} tenantId={tenantId} mod={m} readOnly={readOnly} />)}</div>}
      {denied.length > 0 && (
        <div className="divide-y rounded-md border" data-testid="list-assignment-needed">
          {denied.map((m) => <div key={m.key} className="flex items-center justify-between gap-3 p-3 text-sm" data-testid={`row-needs-assignment-${m.key}`}><span>{m.name}</span><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Assignment needed. Grant it through the plan, add-ons or overrides above.</span></div>)}
        </div>)}
    </Section>
  );
}

export function AdministratorsSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const q = useListTenantAdministrators(tenantId);
  const assign = useAssignTenantAdministrator();
  const gAssign = useGatedMutate(assign.mutate, 'Assign administrator');
  const status = useSetTenantAdministratorStatus();
  const qc = useQueryClient();
  const inv = useInvalidateTenant();
  const { toast } = useToast();
  const [userId, setUserId] = useState('');
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; active: boolean; label: string } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: getListTenantAdministratorsQueryKey(tenantId) }); inv(tenantId); };
  const fail = (t: string) => (e: unknown) => toast({ title: t, description: (e as Error).message, variant: 'destructive' });
  const items = q.data ?? [];
  return (
    <Section n="A1" title="Client administrators" note="Client administrators manage this client's brand, domain, configuration, staff and their access."
      footer={canManage ? <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Super admin only</span> : RO}>
      {q.isLoading ? <Skeleton className="h-16" /> : q.isError ? <ErrorState what="administrators" onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="text-no-admins">No client administrator is assigned.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {items.map((a) => {
            const active = a.status === 'active';
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-3 p-3" data-testid={`row-admin-${a.id}`}>
                <div className="min-w-0 flex-1"><p className="text-sm">{a.label}</p><p className="truncate font-mono text-[11px] text-muted-foreground">{a.reference ?? a.id}</p></div>
                <span className="font-mono text-[10px] uppercase text-muted-foreground" data-testid={`status-admin-${a.id}`}>{a.status}</span>
                {canManage && <Button size="sm" variant={active ? 'destructive' : 'outline'} data-testid={`button-admin-${active ? 'revoke' : 'activate'}-${a.id}`} onClick={() => setConfirm({ id: a.reference ?? a.id, active: !active, label: a.label })}>{active ? 'Revoke' : 'Activate'}</Button>}
              </div>);
          })}
        </div>)}
      {confirm && (
        <div className="space-y-2 rounded-md border border-copper/50 bg-copper/10 p-3" data-testid="panel-confirm-admin">
          <p className="text-sm">{confirm.active ? `Activate ${confirm.label}? They regain full administrator rights on this client, including staff and access grants.` : `Revoke ${confirm.label}? They lose administrator rights on this client immediately.`}</p>
          <div className="flex gap-2">
            <Button size="sm" data-testid="button-confirm-admin" disabled={status.isPending} onClick={() => status.mutate({ tenantId, userId: confirm.id, data: { active: confirm.active } }, { onSuccess: () => { refresh(); setConfirm(null); toast({ title: confirm.active ? 'Administrator activated' : 'Administrator revoked' }); }, onError: fail('Status change failed') })}>{status.isPending ? 'Working' : 'Confirm'}</Button>
            <Button size="sm" variant="ghost" data-testid="button-cancel-admin" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>)}
      {canManage && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); gAssign({ tenantId, data: { userId: userId.trim(), label: label.trim() } }, { onSuccess: () => { setUserId(''); setLabel(''); refresh(); toast({ title: 'Administrator assigned' }); }, onError: fail('Assignment failed') }); }}>
          <Input data-testid="input-admin-userid" className="w-72 font-mono" placeholder="Clerk user ID (user_...)" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <Input data-testid="input-admin-label" className="w-52" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button data-testid="button-assign-admin" disabled={userId.trim().length < 2 || label.trim().length < 2 || assign.isPending}>{assign.isPending ? 'Assigning' : 'Assign administrator'}</Button>
        </form>)}
    </Section>
  );
}
