import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGatedMutate } from '@/components/super-admin/review-gate';
import {
  useListModuleCatalog, useListSandboxAssetNetworks, useUpdateTenantBrand, useUpdateTenantDomain,
  useUpdateTenantAssetsNetworks, useUpdateTenantConfiguration,
  type Tenant, type BrandInput,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useSubscription } from './subscription';
import { usePrincipal } from '@/lib/principal';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useInvalidateTenant } from '@/lib/invalidate';
import { ErrorState } from './bits';

interface SP { tenant: Tenant; readOnly?: boolean; onSaved?: () => void; saveLabel?: string; }
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function Section({ n, title, note, children, footer }: { n: string; title: string; note: string; children: ReactNode; footer: ReactNode }) {
  return (
    <section className="rounded-md border bg-card">
      <header className="flex items-baseline gap-3 border-b px-5 py-4">
        <span className="font-mono text-xs text-copper">{n}</span>
        <div><h2 className="font-display text-2xl leading-none">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{note}</p></div>
      </header>
      <div className="space-y-4 p-5">{children}</div>
      <footer className="flex flex-wrap items-center justify-end gap-3 border-t bg-muted/40 px-5 py-3">{footer}</footer>
    </section>
  );
}

function useSave(tenantId: string, onSaved?: () => void) {
  const { toast } = useToast();
  const inv = useInvalidateTenant();
  return {
    ok: (what: string) => { inv(tenantId); toast({ title: `${what} saved` }); onSaved?.(); },
    fail: (e: unknown) => toast({ title: 'Save failed', description: (e as Error)?.message ?? 'Request rejected', variant: 'destructive' }),
  };
}

function SaveBtn({ pending, disabled, readOnly, label, id }: { pending: boolean; disabled?: boolean; readOnly?: boolean; label?: string; id: string }) {
  if (readOnly) return <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Read only for your role</span>;
  return <Button data-testid={`button-save-${id}`} disabled={pending || disabled} type="submit">{pending ? 'Saving' : label ?? 'Save'}</Button>;
}

export function BrandSection({ tenant, readOnly, onSaved, saveLabel }: SP) {
  const save = useSave(tenant.id, onSaved);
  const m = useUpdateTenantBrand();
  const gM = useGatedMutate(m.mutate, 'Save brand');
  const init = useMemo(() => ({
    brandName: tenant.brandName, logoUrl: tenant.logoUrl ?? '', primaryColor: tenant.primaryColor, accentColor: tenant.accentColor,
    themeMode: tenant.themeMode, defaultLanguage: tenant.defaultLanguage, langs: tenant.supportedLanguages.join(', '),
  }), [tenant]);
  const [f, setF] = useState(init);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState('');
  useEffect(() => setF(init), [init]);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const langs = f.langs.split(',').map((x) => x.trim()).filter(Boolean);
  const err = f.brandName.trim().length < 2 ? 'Brand name needs 2+ characters'
    : !HEX.test(f.primaryColor) || !HEX.test(f.accentColor) ? 'Colors must be #RRGGBB'
    : f.defaultLanguage.trim().length < 2 ? 'Default language needs 2+ characters'
    : langs.length === 0 || langs.some((l) => l.length < 2 || l.length > 12) ? 'Supported languages: comma separated, 2-12 chars each' : '';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: BrandInput = { brandName: f.brandName.trim(), logoUrl: f.logoUrl.trim() || null, primaryColor: f.primaryColor, accentColor: f.accentColor, themeMode: f.themeMode as BrandInput['themeMode'], defaultLanguage: f.defaultLanguage.trim(), supportedLanguages: langs };
    gM({ tenantId: tenant.id, data }, { onSuccess: () => save.ok('Brand'), onError: save.fail });
  };
  const color = (k: 'primaryColor' | 'accentColor', l: string) => (
    <div className="space-y-1.5"><Label>{l}</Label>
      <div className="flex gap-2">
        <input type="color" aria-label={l} disabled={readOnly} value={HEX.test(f[k]) ? f[k] : '#000000'} onChange={(e) => set(k, e.target.value)} className="h-9 w-11 rounded border bg-transparent p-0.5" />
        <Input data-testid={`input-${k}`} disabled={readOnly} className="font-mono" value={f[k]} onChange={(e) => set(k, e.target.value)} />
      </div></div>
  );
  return (
    <form onSubmit={submit}>
      <Section n="01" title="Brand" note="Identity applied to every module this client enables."
        footer={<>{err && !readOnly && <span role="alert" className="mr-auto text-sm text-destructive">{err}</span>}<SaveBtn id="brand" pending={m.isPending} disabled={!!err} readOnly={readOnly} label={saveLabel} /></>}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5"><Label>Brand name</Label><Input data-testid="input-brandName" disabled={readOnly} value={f.brandName} onChange={(e) => set('brandName', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Logo URL</Label><Input data-testid="input-logoUrl" disabled={readOnly || uploadingLogo} placeholder="https://" value={f.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} />
            <Label className="block text-xs text-muted-foreground" htmlFor={`logo-upload-${tenant.id}`}>Or upload a private draft logo (maximum 2 MB), then Save branding and Release.</Label>
            <input id={`logo-upload-${tenant.id}`} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon" disabled={readOnly || uploadingLogo} data-testid="input-release-logo"
              onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                setLogoUploadError(''); setUploadingLogo(true);
                try {
                  if (file.size > 2 * 1024 * 1024) throw new Error('Use an image up to 2 MB.');
                  const r = await fetch(`/api/tenants/${tenant.id}/release-assets`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
                  if (!r.ok) throw new Error('Upload failed. Use a supported image and check your branding permission.');
                  const result = await r.json() as { url: string }; set('logoUrl', result.url);
                } catch (error) { setLogoUploadError(error instanceof Error ? error.message : 'Logo upload failed.'); }
                finally { setUploadingLogo(false); }
              }} />
            {uploadingLogo && <p className="text-xs">Uploading private draft…</p>}
            {logoUploadError && <p role="alert" className="text-xs text-destructive">{logoUploadError}</p>}
          </div>
          {color('primaryColor', 'Primary color')}{color('accentColor', 'Accent color')}
          <div className="space-y-1.5"><Label>Theme mode</Label>
            <Select disabled={readOnly} value={f.themeMode} onValueChange={(v) => set('themeMode', v)}>
              <SelectTrigger data-testid="select-themeMode"><SelectValue /></SelectTrigger>
              <SelectContent>{['light', 'dark', 'system'].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>Default language</Label><Input data-testid="input-defaultLanguage" disabled={readOnly} value={f.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value)} /></div>
          <div className="space-y-1.5 md:col-span-2"><Label>Supported languages</Label><Input data-testid="input-supportedLanguages" disabled={readOnly} placeholder="en, de, es" value={f.langs} onChange={(e) => set('langs', e.target.value)} /></div>
        </div>
        <div className="flex items-center gap-3 rounded-md border p-3" data-testid="preview-brand">
          <div className="grid h-10 w-10 place-items-center rounded-md font-display text-lg text-white" style={{ background: HEX.test(f.primaryColor) ? f.primaryColor : '#999' }}>{(f.brandName || '?')[0]}</div>
          <span className="font-medium">{f.brandName || 'Brand preview'}</span>
          <span className="ml-auto h-3 w-16 rounded-full" style={{ background: HEX.test(f.accentColor) ? f.accentColor : '#999' }} />
        </div>
      </Section>
    </form>
  );
}

export function DomainSection({ tenant, readOnly, onSaved, saveLabel }: SP) {
  const save = useSave(tenant.id, onSaved);
  const m = useUpdateTenantDomain();
  const gM = useGatedMutate(m.mutate, 'Save domain');
  const [d, setD] = useState(tenant.domain ?? '');
  useEffect(() => setD(tenant.domain ?? ''), [tenant.domain]);
  const v = d.trim().toLowerCase();
  const bad = v !== '' && !/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v);
  return (
    <form onSubmit={(e) => { e.preventDefault(); gM({ tenantId: tenant.id, data: { domain: v || null } }, { onSuccess: () => save.ok('Domain'), onError: save.fail }); }}>
      <Section n="02" title="Domain" note="Saving stores the domain as unverified. Ownership is verified independently with a TXT record, and HTTPS is proven separately after hosting is registered."
        footer={<>{bad && <span role="alert" className="mr-auto text-sm text-destructive">Enter a hostname like app.example.com</span>}<SaveBtn id="domain" pending={m.isPending} disabled={bad} readOnly={readOnly} label={saveLabel ?? (v ? 'Save domain' : 'Save without domain')} /></>}>
        <div className="space-y-1.5"><Label>Custom domain (optional)</Label>
          <Input data-testid="input-domain" disabled={readOnly} className="font-mono" placeholder="app.example.com" value={d} onChange={(e) => setD(e.target.value)} /></div>
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Status: unverified · leave empty to clear</p>
      </Section>
    </form>
  );
}

export function ModulesSection({ tenant, onSaved, saveLabel }: SP) {
  const cat = useListModuleCatalog();
  const sub = useSubscription(tenant.id);
  const on = sub.data?.enabledModules ?? tenant.enabledModules;
  return (
    <Section n="03" title="Modules" note="Effective modules come from the plan, add-ons and overrides. Change the plan or overrides to change them."
      footer={<><span className="mr-auto font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Set by plan assignment</span>{onSaved && <Button type="button" data-testid="button-continue-modules" onClick={onSaved}>{saveLabel ?? 'Continue'}</Button>}</>}>
      {cat.isLoading || sub.isLoading ? <Skeleton className="h-40" /> : cat.isError ? <ErrorState what="module catalog" onRetry={() => cat.refetch()} /> : (
        <div className="grid gap-2 md:grid-cols-2">
          {cat.data?.filter((mod) => on.includes(mod.key)).map((mod) => (
            <div key={mod.key} className="flex gap-3 rounded-md border border-primary bg-primary/5 p-3" data-testid={`module-${mod.key}`}>
              <span><span className="block text-sm font-medium">{mod.name}</span><span className="block text-xs text-muted-foreground">{mod.description}</span></span>
            </div>))}
          {on.length === 0 && <p className="text-sm text-muted-foreground">No modules are enabled by the current subscription.</p>}
        </div>)}
    </Section>
  );
}

export function AssetsSection({ tenant, readOnly, onSaved, saveLabel, renderAsset, renderNetwork }: SP & { renderAsset?: (row: { assetId: string; symbol: string; name: string }) => ReactNode; renderNetwork?: (row: { assetId: string; networkId: string; networkName: string }) => ReactNode }) {
  const save = useSave(tenant.id, onSaved);
  const cat = useListSandboxAssetNetworks();
  const m = useUpdateTenantAssetsNetworks();
  const gM = useGatedMutate(m.mutate, 'Save assets and networks');
  const [sel, setSel] = useState<string[]>(tenant.assetNetworkIds);
  const [saveError, setSaveError] = useState<string | null>(null);
  const key = tenant.assetNetworkIds.join(',');
  useEffect(() => setSel(tenant.assetNetworkIds), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const groups = useMemo(() => {
    const g = new Map<string, NonNullable<typeof cat.data>['assets']>();
    cat.data?.assets.forEach((a) => g.set(a.assetId, [...(g.get(a.assetId) ?? []), a]));
    return [...g.entries()];
  }, [cat.data]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); setSaveError(null); gM({ tenantId: tenant.id, data: { assetNetworkIds: sel } }, {
      onSuccess: () => { setSaveError(null); save.ok('Assets and networks'); },
      onError: (error) => { setSaveError(error instanceof Error ? error.message : 'Assets and networks could not be saved.'); save.fail(error); },
    }); }}>
      <Section n="04" title="Assets and networks" note="Configured sandbox asset/network pairs only."
        footer={<><span className="mr-auto font-mono text-xs text-muted-foreground">{sel.length} selected</span><SaveBtn id="assets" pending={m.isPending} readOnly={readOnly} label={saveLabel} /></>}>
        {saveError && <p role="alert" data-testid="error-save-assets" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</p>}
        {cat.isLoading ? <Skeleton className="h-40" /> : cat.isError ? <ErrorState what="asset catalog" onRetry={() => cat.refetch()} /> : (
          <div className="divide-y rounded-md border">
            {groups.map(([id, rows]) => (
              <div key={id} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
                <div className="w-40">{renderAsset ? renderAsset(rows[0]) : <><span className="font-mono text-sm font-medium">{rows[0].symbol}</span><span className="ml-2 text-xs text-muted-foreground">{rows[0].name}</span></>}</div>
                {rows.map((r) => { const v = r.assetNetworkId ?? `${r.assetId}:${r.networkId}`; return (
                  <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox data-testid={`checkbox-asset-${v}`} disabled={readOnly} checked={sel.includes(v)} onCheckedChange={() => toggle(v)} />
                    {renderNetwork ? renderNetwork(r) : r.networkName}{r.testnet && <span className="font-mono text-[10px] uppercase text-copper">testnet</span>}
                  </label>); })}
              </div>
            ))}
          </div>
        )}
      </Section>
    </form>
  );
}

export function ConfigSection({ tenant, readOnly, onSaved, saveLabel }: SP) {
  const save = useSave(tenant.id, onSaved);
  const m = useUpdateTenantConfiguration();
  const gM = useGatedMutate(m.mutate, 'Save configuration');
  const sub = useSubscription(tenant.id);
  const p = usePrincipal();
  const feats = sub.data?.features ?? {};
  const avail = { x: feats.crypto_exchange === true, p: feats.crypto_payments === true, g: feats.crypto_payments === true };
  const [f, setF] = useState({ x: tenant.exchangeEnabled, p: tenant.paymentsEnabled, g: tenant.allowGuestCheckout });
  useEffect(() => setF({ x: tenant.exchangeEnabled, p: tenant.paymentsEnabled, g: tenant.allowGuestCheckout }), [tenant.exchangeEnabled, tenant.paymentsEnabled, tenant.allowGuestCheckout]);
  const rows: [keyof typeof f, string, string][] = [
    ['x', 'Exchange flag', 'Marks the exchange surface as switched on in configuration.'],
    ['p', 'Payments flag', 'Marks the payments surface as switched on in configuration.'],
    ['g', 'Allow guest checkout', 'Permit sessions without a registered end-user.'],
  ];
  const shown = rows.filter(([k]) => p.role !== 'client_admin' || avail[k]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); gM({ tenantId: tenant.id, data: { environment: 'sandbox', exchangeEnabled: avail.x && f.x, paymentsEnabled: avail.p && f.p, allowGuestCheckout: avail.g && f.g } }, { onSuccess: () => save.ok('Configuration'), onError: save.fail }); }}>
      <Section n="05" title="Configuration" note="Environment is fixed to sandbox. Flags the subscription does not grant are saved as off."
        footer={<SaveBtn id="config" pending={m.isPending} disabled={sub.isLoading} readOnly={readOnly} label={saveLabel} />}>
        <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3"><span className="text-sm">Environment</span><span className="font-mono text-xs uppercase tracking-wider text-copper">sandbox</span></div>
        {shown.map(([k, t, d]) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <div><p className="text-sm font-medium">{t}</p><p className="text-xs text-muted-foreground">{avail[k] ? d : 'Not granted by the current subscription.'}</p></div>
            <Switch data-testid={`switch-${k}`} disabled={readOnly || !avail[k]} checked={avail[k] && f[k]} onCheckedChange={(v) => setF((s) => ({ ...s, [k]: v }))} />
          </div>
        ))}
        {shown.length === 0 && <p className="text-sm text-muted-foreground">No configurable options are available for your subscription.</p>}
      </Section>
    </form>
  );
}
