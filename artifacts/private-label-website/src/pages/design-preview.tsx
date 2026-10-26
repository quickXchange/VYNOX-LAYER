import { lazy, Suspense, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { SiteShell } from '@/components/site-shell';
import { Hero } from '@/components/hero';
import { PresentationWidget, SimulationContext, type WidgetSimulation } from '@/components/exchange/presentation-widget';
import { useBridge, reconnect, type BridgeStatus } from '@/lib/preview-bridge-client';
import { applyBranding, enabledAssets, enabledMethods, getSimState, simDispatch, useSimState } from '@/lib/sim-store';
import { PaymentMock } from '@/components/sections/payments';
import { resolveCaps } from '@/lib/capabilities';
import { humanize } from '@/lib/theme';
import { DEFAULT_PREVIEW, DESIGN_PREVIEW_ROOT, previewSite, samplePrice } from '@/lib/design-preview-bridge';

const BelowFold = lazy(() => import('@/components/below-fold'));
export const ADMIN_ROOT = `${DESIGN_PREVIEW_ROOT}/admin`;

const STATUS_COPY: Record<BridgeStatus, string> = {
  connecting: 'Connecting to your purchase draft...',
  live: 'Showing your purchase draft branding. Updates live while the purchase page stays open.',
  standalone: 'Standalone preview: showing the NovaX sample brand.',
  unsupported: 'This browser cannot link to your purchase draft. Showing the NovaX sample brand.',
  closed: 'The purchase page was closed or left. Showing the last branding received; it no longer updates.',
  timeout: 'Your purchase draft did not respond (page closed?). Showing the NovaX sample brand.',
};

/** Shared provider: bridged draft config + in-memory simulation store. No network calls. */
export function usePreviewModel() {
  const bridge = useBridge();
  const sim = useSimState();
  const cfg = applyBranding(bridge.status === 'live' || bridge.received ? bridge.cfg : DEFAULT_PREVIEW, sim.branding);
  const site = previewSite(cfg, enabledAssets(sim));
  const simulation: WidgetSimulation = {
    price: (id) => sim.prices[id] ?? samplePrice(id),
    paymentMethods: enabledMethods(sim),
    onComplete: (o) => { const before = getSimState(); simDispatch({ type: 'addOrder', order: o, at: Date.now() }); const after = getSimState(); return after !== before ? after.orders[0].ref : after.orders.find((x) => x.clientId === o.clientId)?.ref ?? null; },
    adminHref: (ref) => `${ADMIN_ROOT}/orders/${ref}`,
  };
  return { bridge, site, simulation };
}

export function PreviewBanner({ admin }: { admin?: boolean }) {
  const { bridge } = usePreviewModel();
  const warn = bridge.status !== 'live' && bridge.status !== 'connecting';
  return (
    <aside className="sticky top-0 z-[60] border-b bg-amber-50 text-amber-950" data-testid="banner-design-preview">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-xs">
        <span className="rounded bg-amber-900 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-50">Simulation</span>
        <span className="font-medium">No real payments, live quotes, blockchain, providers, notifications or business APIs. Demo records live in this tab's memory and clear on reload or reset.</span>
        <nav className="ml-auto flex gap-1" aria-label="Simulation navigation">
          <Link href={DESIGN_PREVIEW_ROOT} className={`rounded px-2 py-1 font-semibold ${!admin ? 'bg-amber-900 text-amber-50' : 'hover:bg-amber-100'}`} data-testid="link-sim-website">Website</Link>
          <Link href={ADMIN_ROOT} className={`rounded px-2 py-1 font-semibold ${admin ? 'bg-amber-900 text-amber-50' : 'hover:bg-amber-100'}`} data-testid="link-sim-admin">Admin panel (simulation)</Link>
        </nav>
        <p className={`basis-full ${warn ? 'font-semibold text-amber-900' : 'opacity-80'}`} role="status" data-testid={`status-bridge-${bridge.status}`}>
          {STATUS_COPY[bridge.status]}
          {(bridge.status === 'closed' || bridge.status === 'timeout') && <button type="button" onClick={reconnect} className="ml-2 underline" data-testid="button-bridge-retry">Try reconnecting</button>}
        </p>
      </div>
    </aside>);
}

function Frame({ children }: { children: (site: ReturnType<typeof previewSite>) => ReactNode }) {
  const { bridge, site, simulation } = usePreviewModel();
  if (bridge.status === 'connecting' && !bridge.received) return (
    <div className="min-h-[100dvh] bg-amber-50/40 p-6" aria-busy="true" data-testid="state-bridge-connecting"><div className="mx-auto max-w-5xl space-y-4"><div className="h-6 w-48 animate-pulse rounded bg-amber-100" /><div className="h-72 animate-pulse rounded bg-amber-100" /><p className="text-sm text-amber-900">{STATUS_COPY.connecting}</p></div></div>);
  return (
    <SimulationContext.Provider value={simulation}>
      <PreviewBanner />
      <SiteShell key={`${site.themeMode}`} site={site} ambient>{children(site)}</SiteShell>
    </SimulationContext.Provider>
  );
}

const Narrow = ({ children }: { children: ReactNode }) => <div className="s-wrap s-rise py-16 md:py-24"><div className="mx-auto max-w-3xl">{children}</div></div>;
const Back = () => <Link href={DESIGN_PREVIEW_ROOT} className="s-btn s-btn-ghost mt-8" data-testid="link-back-home">Back to home</Link>;

export function DesignPreviewHome() {
  return <Frame>{(site) => {
    const caps = resolveCaps(site);
    return <><Hero site={site} caps={caps} root={DESIGN_PREVIEW_ROOT} /><Suspense fallback={<div className="s-wrap py-20"><div className="s-skel h-8 w-64" /></div>}><BelowFold site={site} caps={caps} /></Suspense></>;
  }}</Frame>;
}

export function DesignPreviewFeature() {
  const { feature = '' } = useParams<{ feature: string }>();
  return <Frame>{(site) => {
    const caps = resolveCaps(site);
    if (feature !== caps.exchangeKey && feature !== 'swap' && feature !== 'convert') return (
      <Narrow><p className="s-eyebrow">Not available</p><h1 className="s-h2 mt-3">This service is not part of the preview</h1><p className="s-muted mt-4">{humanize(feature)} is not shown in the standard Exchange design preview.</p><Back /></Narrow>);
    return (
      <div className="s-wrap s-rise py-12 md:py-20"><div className="mx-auto max-w-6xl">
        <p className="s-eyebrow">Sample - simulation</p>
        <h1 className="s-h2 mt-3">{humanize(caps.exchangeKey ?? feature)}</h1>
        <p className="s-muted mt-4 text-lg leading-relaxed">Try Swap between fiat and crypto or Convert between two crypto assets. Continue through details, review and confirmation to a completed simulated order. Every figure is a synthetic sample.</p>
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"><div><PresentationWidget key={feature} site={site} caps={caps} allowedActions={feature === 'swap' ? ['swap'] : feature === 'convert' ? ['convert'] : undefined} /></div>
        <div><PaymentMock site={site} /></div></div>
        <p className="s-card mt-8 p-4 text-sm s-muted">Product simulation. No real orders, payments or transfers can be made here. Completed simulated orders appear in the admin panel (simulation) as in-memory demo records for this tab.</p>
        <Back />
      </div></div>);
  }}</Frame>;
}

export function DesignPreviewLegal({ kind }: { kind: 'privacy' | 'terms' }) {
  return <Frame>{(site) => (
    <Narrow>
      <p className="s-eyebrow">{site.brandName}</p>
      <h1 className="s-h2 mt-3">{kind === 'privacy' ? 'Privacy policy' : 'Terms of service'}</h1>
      <p className="s-card mt-8 p-5 s-muted" data-testid={`text-${kind}-empty`}>Your published document will appear here. Sample placeholder in the design preview.</p>
      <Back />
    </Narrow>)}</Frame>;
}
