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

type PreviewMode = 'website' | 'admin';

const products = [
  { name: 'Crypto / Fiat Swap', detail: 'Crypto to fiat, and fiat to crypto', icon: ArrowLeftRight },
  { name: 'Crypto / Crypto Convert', detail: 'Convert between supported digital assets', icon: ArrowDownUp },
];

function SandboxBanner() {
  return (
    <aside
      className="mb-7 flex items-start gap-3 rounded-xl border border-amber-700/20 bg-amber-50/80 px-4 py-3.5 text-amber-950 dark:border-amber-300/20 dark:bg-amber-950/30 dark:text-amber-100 sm:px-5"
      aria-label="Sandbox preview notice"
      data-testid="banner-sandbox-preview"
    >
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">Protected Sandbox preview · fictional customer demo</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/75 sm:text-sm">
          This is not a live exchange or customer configuration. No real quotes, payments, orders, or trades are available here.
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
              A proposed Abracadabra experience for exploring supported crypto and fiat exchange journeys.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {products.map(({ name }) => (
                <span key={name} className="rounded-full border border-[#332b37]/15 bg-white/55 px-3 py-2 text-xs font-medium">{name}</span>
              ))}
            </div>
            <p className="mt-6 text-xs text-[#766e76]">Illustrative interface only. No exchange service is connected.</p>
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
        <span>Fictional customer website, shown inside the protected VYNOX workspace.</span>
        <span className="font-mono uppercase tracking-[0.12em]">Not a customer site</span>
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

function AdminExperience() {
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
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Tenant admin · illustrative</p>
              <h2 className="mt-2 font-display text-2xl tracking-tight sm:text-3xl">Workspace overview</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">A sample of the tenant-admin surface for review.</p>
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
                    <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                  </div>
                </div>
              </section>
            ))}
          </div>

          <section className="mt-5 rounded-xl border border-border/80 bg-background/60 p-4 sm:p-5" aria-labelledby="admin-config-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="admin-config-heading" className="font-display text-lg">Example configuration</h3>
                <p className="mt-1 text-xs text-muted-foreground">Static samples for interface review. No tenant data is being read.</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">Fictional</span>
            </div>
            <div className="mt-2">
              <ReadOnlyRow icon={WalletCards} label="Illustrative assets" value="BTC · ETH · USDC" note="Sample asset names only; availability is not connected to a provider." />
              <ReadOnlyRow icon={Network} label="Illustrative networks" value="Ethereum · Arbitrum" note="Example network labels only; no network connection is configured." />
              <ReadOnlyRow icon={Globe2} label="Proposed hostname" value="abracadabra-demo.vynoxlayer.com · NOT REGISTERED" note="Not purchased, registered, or connected. The review link remains this protected VYNOX workspace." />
            </div>
          </section>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-border/70 bg-muted/30 p-4">
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              This view demonstrates layout only. No save, submit, DNS, integration, order, or trade actions are available.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AbracadabraPreview() {
  const [mode, setMode] = useState<PreviewMode>('website');
  return (
    <div className="mx-auto w-full max-w-6xl" data-testid="page-abracadabra-preview">
      <SandboxBanner />
      <ViewSwitcher mode={mode} onChange={setMode} />
      <div
        id="abracadabra-preview-panel"
        role="tabpanel"
        aria-labelledby={`abracadabra-tab-${mode}`}
        className="pt-6"
      >
        {mode === 'website' ? <WebsiteExperience /> : <AdminExperience />}
      </div>
      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        The review link is the current protected VYNOX workspace; it is not a customer-facing or registered website.
      </p>
    </div>
  );
}
