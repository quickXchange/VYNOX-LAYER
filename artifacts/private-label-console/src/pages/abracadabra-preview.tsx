import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownUp,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Globe2,
  Layers3,
  LockKeyhole,
  Network,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  useGetDomainVerification,
  getGetDomainVerificationQueryKey,
  useGetTenant,
  getGetTenantQueryKey,
  useListTenants,
  type DomainVerification,
} from '@workspace/api-client-react';
import { WebsitePreviewAction } from '@/components/app/website-preview-action';
import { Skeleton } from '@/components/ui/skeleton';

type PreviewMode = 'website' | 'admin';
type TenantReview = {
  id: string;
  name: string;
  slug: string;
  brandName: string;
  domain: string | null;
  status: string;
  environment: string;
  enabledModules: string[];
  assetNetworkIds: string[];
  exchangeEnabled: boolean;
  paymentsEnabled: boolean;
  allowGuestCheckout: boolean;
};

const products = [
  { name: 'Crypto / Fiat Swap', detail: 'Crypto to fiat, and fiat to crypto', icon: ArrowLeftRight },
  { name: 'Crypto / Crypto Convert', detail: 'Convert between supported digital assets', icon: ArrowDownUp },
];

function SandboxBanner({ status }: { status: string }) {
  return (
    <aside
      className="mb-7 flex items-start gap-3 rounded-xl border border-amber-700/20 bg-amber-50/80 px-4 py-3.5 text-amber-950 dark:border-amber-300/20 dark:bg-amber-950/30 dark:text-amber-100 sm:px-5"
      aria-label="Sandbox preview notice"
      data-testid="banner-sandbox-preview"
    >
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">Protected Sandbox preview · {status === 'draft' ? 'Development draft' : `Development ${status}`}</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/75 sm:text-sm">
          This tenant is an unactivated draft. Exchange routes, pricing, payments, orders, and financial execution are off.
        </p>
      </div>
      <span className="ml-auto hidden shrink-0 rounded-full border border-current/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] sm:inline-flex">Read only</span>
    </aside>
  );
}

function ViewSwitcher({ mode, onChange }: { mode: PreviewMode; onChange: (next: PreviewMode) => void }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Experience review</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight sm:text-4xl">Abracadabra</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review the proposed customer website and tenant-admin experience.</p>
      </div>
      <div role="tablist" aria-label="Preview experience" className="inline-flex w-fit rounded-xl border border-border bg-card/70 p-1">
        {([
          ['website', 'Customer website'],
          ['admin', 'Tenant admin'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`abracadabra-tab-${value}`}
            aria-selected={mode === value}
            aria-controls="abracadabra-preview-panel"
            onClick={() => onChange(value)}
            className={`min-h-10 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--s-accent-ink)] sm:px-4 ${
              mode === value
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SampleAsset({ symbol, name, note }: { symbol: string; name: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-full border border-[#cfad69]/35 bg-[#cfad69]/10 font-mono text-[11px] font-semibold text-[#ead8ad]">{symbol}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{name}</span>
        <span className="block text-xs text-white/55">{note}</span>
      </span>
      <Check className="ml-auto h-4 w-4 text-[#cfad69]" aria-hidden="true" />
    </div>
  );
}

function ProductDemo({ convert = false }: { convert?: boolean }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#211d2b] p-4 text-white shadow-[0_24px_70px_-42px_rgba(0,0,0,.8)] sm:p-5" aria-label={convert ? 'Crypto to crypto convert sample' : 'Crypto to fiat swap sample'}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#cfad69]/12 text-[#ead8ad]">
            {convert ? <ArrowDownUp className="h-4 w-4" /> : <ArrowLeftRight className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{convert ? 'Crypto / Crypto Convert' : 'Crypto / Fiat Swap'}</h3>
            <p className="mt-0.5 text-xs text-white/55">Illustrative product preview</p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/55">Sample</span>
      </div>
      <div className="mt-5 space-y-2">
        <SampleAsset symbol="BTC" name="Bitcoin" note={convert ? 'From asset' : 'Crypto asset'} />
        <div className="flex justify-center py-0.5 text-[#cfad69]" aria-hidden="true">
          {convert ? <ArrowDownUp className="h-4 w-4" /> : <ArrowLeftRight className="h-4 w-4" />}
        </div>
        <SampleAsset symbol={convert ? 'ETH' : 'USD'} name={convert ? 'Ether' : 'Fiat currency'} note={convert ? 'Ethereum · Arbitrum' : 'Fiat destination sample'} />
      </div>
      <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/50">
        No amount, rate, quote, or transaction is shown or available in this preview.
      </p>
    </section>
  );
}

function WebsiteExperience() {
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-border/80 bg-[#f6f3ed] text-[#282329] shadow-sm" data-testid="panel-customer-website">
      <div className="flex items-center justify-between gap-4 border-b border-[#282329]/10 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#332b37] text-[#e2c987]"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
          <span className="font-display text-base font-semibold tracking-tight">ABRACADABRA</span>
        </div>
        <nav aria-label="Customer website preview navigation" className="hidden items-center gap-6 text-xs text-[#5d5660] sm:flex">
          <span>Swap</span><span>Convert</span><span>About</span>
        </nav>
        <span className="rounded-full border border-[#332b37]/15 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#625968]">Website concept</span>
      </div>

      <div className="relative isolate overflow-hidden px-5 pb-8 pt-10 sm:px-10 sm:pb-12 sm:pt-14">
        <div className="pointer-events-none absolute -right-20 -top-20 -z-10 h-72 w-72 rounded-full border border-[#b69b67]/20 sm:right-[-4rem] sm:top-[-5rem]" />
        <div className="pointer-events-none absolute right-[-3rem] top-[-3rem] -z-10 h-56 w-56 rounded-full border border-[#b69b67]/25 sm:right-[-1rem]" />
        <div className="grid gap-8 lg:grid-cols-[1fr_0.82fr] lg:items-center">
          <div className="max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#837047]">A considered exchange experience</p>
            <h2 className="mt-4 max-w-lg font-display text-4xl font-semibold leading-[1.04] tracking-[-0.055em] sm:text-6xl">
              Move between worlds.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-6 text-[#625b63] sm:text-base sm:leading-7">
              A review of the Abracadabra brand direction and its two proposed Exchange products.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {products.map(({ name }) => (
                <span key={name} className="rounded-full border border-[#332b37]/15 bg-white/55 px-3 py-2 text-xs font-medium">{name}</span>
              ))}
            </div>
            <p className="mt-6 text-xs text-[#766e76]">This card is a visual concept. Use the protected website preview above to open the real NovaX master with Abracadabra&apos;s saved draft settings.</p>
          </div>

          <div className="relative mx-auto w-full max-w-[430px]">
            <div className="absolute -inset-3 -z-10 rotate-2 rounded-[1.7rem] border border-[#b69b67]/30" />
            <div className="rounded-[1.4rem] bg-[#17151d] p-4 shadow-[0_28px_55px_-34px_rgba(29,23,33,.75)] sm:p-5">
              <div className="mb-4 flex items-center justify-between px-1">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/50">Explore an exchange</p>
                  <p className="mt-1 text-sm font-semibold text-white">Choose a journey</p>
                </div>
                <CircleHelp className="h-4 w-4 text-white/45" aria-hidden="true" />
              </div>
              <div className="grid gap-3">
                <ProductDemo />
                <ProductDemo convert />
              </div>
              <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[0.15em] text-white/35">Sandbox concept · no live quote</p>
            </div>
          </div>
        </div>
      </div>
      <footer className="flex flex-col gap-2 border-t border-[#282329]/10 px-5 py-4 text-[11px] text-[#766e76] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>Brand concept shown inside the protected VYNOX workspace.</span>
        <span className="font-mono uppercase tracking-[0.12em]">Development draft</span>
      </footer>
    </div>
  );
}

function ReadOnlyRow({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string; note: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-4 last:border-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/70 text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 break-words text-sm text-muted-foreground">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground/80">{note}</p>
      </div>
      <span className="mt-1 rounded-full border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Preview</span>
    </div>
  );
}

function AdminExperience({ tenant }: { tenant: TenantReview }) {
  const exchangePlanEnabled = tenant.enabledModules.includes('crypto_exchange');
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-border/80 bg-card shadow-sm" data-testid="panel-tenant-admin">
      <div className="grid min-h-[580px] lg:grid-cols-[218px_1fr]">
        <aside className="border-b border-border/70 bg-muted/25 p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-foreground text-background"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
            <span className="font-display text-sm font-semibold tracking-tight">Abracadabra</span>
          </div>
          <p className="mb-2 mt-7 px-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Tenant workspace</p>
          <nav aria-label="Illustrative tenant admin navigation" className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
            {[
              ['Overview', Layers3, true],
              ['Swap', ArrowLeftRight, false],
              ['Convert', ArrowDownUp, false],
              ['Website', Globe2, false],
            ].map(([label, Icon, current]) => {
              const ItemIcon = Icon as typeof Layers3;
              return (
                <div key={label as string} aria-current={current ? 'page' : undefined} className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-xs font-medium ${current ? 'bg-foreground text-background' : 'text-muted-foreground'}`}>
                  <ItemIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{label as string}</span>
                </div>
              );
            })}
          </nav>
          <div className="mt-6 hidden rounded-xl border border-border/70 bg-card/70 p-3 lg:block">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Access</p>
            <p className="mt-2 flex items-center gap-2 text-xs font-medium"><LockKeyhole className="h-3.5 w-3.5 text-muted-foreground" /> Read-only preview</p>
          </div>
        </aside>

        <div className="min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Tenant admin · saved Development draft</p>
              <h2 className="mt-2 font-display text-2xl tracking-tight sm:text-3xl">Workspace overview</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Read-only status from the isolated Abracadabra tenant.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground"><LockKeyhole className="h-3 w-3" /> Protected preview</span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {products.map(({ name, detail, icon: Icon }) => (
              <section key={name} className="rounded-xl border border-border/80 bg-background/60 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted/70 text-foreground"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <div>
                    <h3 className="text-sm font-semibold">{name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{exchangePlanEnabled ? 'Included in the internal Sandbox plan; no pricing or routes are enabled.' : detail}</p>
                  </div>
                </div>
              </section>
            ))}
          </div>

          <section className="mt-5 rounded-xl border border-border/80 bg-background/60 p-4 sm:p-5" aria-labelledby="admin-config-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="admin-config-heading" className="font-display text-lg">Saved Sandbox configuration</h3>
                <p className="mt-1 text-xs text-muted-foreground">Read-only values from the actual Development tenant.</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">Fictional</span>
            </div>
            <div className="mt-2">
              <ReadOnlyRow icon={WalletCards} label="Selected asset/network pairs" value={`${tenant.assetNetworkIds.length} verified catalog assignment${tenant.assetNetworkIds.length === 1 ? '' : 's'}`} note="Selected from the existing Development Exchange catalog. No provider connection or wallet is configured." />
              <ReadOnlyRow icon={Network} label="Exchange route configuration" value={tenant.exchangeEnabled ? 'Enabled' : 'Disabled'} note="Exchange operations stay off; no rates, routes, or quotes are configured." />
              <ReadOnlyRow icon={Globe2} label="Customer domain" value={tenant.domain ?? 'None — not requested'} note="The proposed abracadabra-demo.vynoxlayer.com hostname is not assigned or registered." />
              <ReadOnlyRow icon={WalletCards} label="Payments and guest checkout" value={tenant.paymentsEnabled || tenant.allowGuestCheckout ? 'Enabled' : 'Disabled'} note="No payment methods or customer checkout are available." />
            </div>
          </section>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-border/70 bg-muted/30 p-4">
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              This page is read-only. Use the existing tenant settings for a separately approved domain request; this preview never edits DNS or hosting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DomainStep({
  number,
  title,
  detail,
  complete,
  current,
}: {
  number: string;
  title: string;
  detail: string;
  complete: boolean;
  current: boolean;
}) {
  return (
    <li className="flex gap-3 rounded-xl border border-border/70 bg-background/60 p-3.5">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold ${complete ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : current ? 'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'border-border text-muted-foreground'}`}>
        {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : number}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{detail}</span>
        <span className="mt-2 inline-flex rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          {complete ? 'Complete' : current ? 'Next step' : 'Waiting'}
        </span>
      </span>
    </li>
  );
}

function DomainSetupGuide({ tenantId }: { tenantId: string }) {
  const query = useGetDomainVerification(tenantId, { query: { queryKey: getGetDomainVerificationQueryKey(tenantId), retry: false } });
  const domain: DomainVerification | undefined = query.data;

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.isError || !domain) {
    return <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">Domain status is unavailable. Reopen this page or check the tenant domain settings.</p>;
  }

  const hasDomain = !!domain.domain;
  const ownershipVerified = domain.status === 'verified';
  const hostingRegistered = domain.providerRegistered === true || domain.hostingConnected;
  const httpsReady = domain.httpsReady === true;
  const stage = !hasDomain ? 0 : !ownershipVerified ? 1 : !hostingRegistered ? 2 : !httpsReady ? 3 : 4;

  return (
    <section className="mt-6 rounded-2xl border border-border/80 bg-card/70 p-4 shadow-sm sm:p-5" aria-labelledby="domain-setup-heading" data-testid="abracadabra-domain-guide">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-muted-foreground">Domain readiness</p>
          <h2 id="domain-setup-heading" className="mt-1 font-display text-xl">From domain request to HTTPS</h2>
          <p className="mt-1 text-sm text-muted-foreground">{hasDomain ? `Current request: ${domain.domain}` : 'No customer-owned domain has been requested or saved.'}</p>
        </div>
        <Link href={`/clients/${tenantId}`} className="inline-flex min-h-10 items-center rounded-lg border border-border px-3.5 text-sm font-medium hover:bg-muted/60" data-testid="link-abracadabra-domain-settings">
          Open tenant settings
        </Link>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        <DomainStep number="01" title="Confirm the hostname" complete={hasDomain} current={stage === 0}
          detail={hasDomain ? 'The hostname is saved to this tenant.' : 'The customer must choose and control a hostname. Do not use the proposed VYNOX sample host without explicit assignment.'} />
        <DomainStep number="02" title="Prove DNS ownership" complete={ownershipVerified} current={stage === 1}
          detail={ownershipVerified ? 'The exact ownership TXT challenge has been verified.' : hasDomain ? 'Add the exact TXT record shown in tenant settings, then check DNS. VYNOX does not edit customer DNS.' : 'Available after a hostname is confirmed and saved.'} />
        <DomainStep number="03" title="Connect approved hosting" complete={hostingRegistered} current={stage === 2}
          detail={hostingRegistered ? 'The hostname is registered with the hosting provider.' : ownershipVerified ? `An operator must register this exact hostname on the approved ${domain.hostingProvider === 'vercel' ? 'Vercel' : 'Replit'} project.` : 'Wait until domain ownership is verified.'} />
        <DomainStep number="04" title="Verify HTTPS and routing" complete={httpsReady} current={stage === 3}
          detail={httpsReady ? 'The site passed the HTTPS and tenant-routing check.' : hostingRegistered ? 'After DNS propagates and the hosting provider issues TLS, run the read-only HTTPS check.' : 'Wait until hosting registration is complete.'} />
      </ol>
      <p className="mt-4 rounded-lg border border-border/70 bg-muted/25 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        This guide does not buy, register, publish, or connect a domain. It never changes DNS. The review site stays on the protected VYNOX workspace until a customer hostname is approved and HTTPS is verified.
      </p>
    </section>
  );
}

export default function AbracadabraPreview() {
  const tenants = useListTenants();
  const summary = tenants.data?.find((item) => item.slug === 'abracadabra-demo');
  if (tenants.isLoading) return <div className="mx-auto w-full max-w-6xl space-y-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-[520px] w-full" /></div>;
  if (tenants.isError) return <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">Abracadabra Sandbox status could not be loaded. Retry the workspace preview.</p>;
  if (!summary) return <p role="alert" className="rounded-xl border border-amber-700/20 bg-amber-50 p-4 text-sm text-amber-950">The protected Abracadabra tenant has not been provisioned in Development.</p>;
  return <TenantExperience tenantId={summary.id} />;
}

function TenantExperience({ tenantId }: { tenantId: string }) {
  const [mode, setMode] = useState<PreviewMode>('website');
  const tenantQuery = useGetTenant(tenantId, { query: { queryKey: getGetTenantQueryKey(tenantId), retry: false } });
  if (tenantQuery.isLoading) return <div className="mx-auto w-full max-w-6xl space-y-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-[520px] w-full" /></div>;
  if (tenantQuery.isError || !tenantQuery.data) return <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">Abracadabra tenant details could not be loaded. Retry the workspace preview.</p>;
  const tenant = tenantQuery.data;
  return (
    <div className="mx-auto w-full max-w-6xl" data-testid="page-abracadabra-preview">
      <SandboxBanner status={tenant.status} />
      <ViewSwitcher mode={mode} onChange={setMode} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3">
        <div>
          <p className="text-sm font-medium">{tenant.brandName} · {tenant.environment} · {tenant.status}</p>
          <p className="mt-1 text-xs text-muted-foreground">Private website preview expires after 15 minutes. Tenant configuration remains a draft.</p>
        </div>
        <WebsitePreviewAction tenantId={tenant.id} />
      </div>
      <div
        id="abracadabra-preview-panel"
        role="tabpanel"
        aria-labelledby={`abracadabra-tab-${mode}`}
        className="pt-6"
      >
        {mode === 'website' ? <WebsiteExperience /> : <AdminExperience tenant={tenant} />}
      </div>
      <DomainSetupGuide tenantId={tenant.id} />
      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {tenant.status === 'draft'
          ? 'This draft is not customer-delivered or publicly released. Domain ownership and HTTPS status are shown separately below.'
          : 'This page is a protected VYNOX review surface. Domain ownership and HTTPS status are shown separately below.'}
      </p>
    </div>
  );
}
