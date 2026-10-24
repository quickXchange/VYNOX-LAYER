import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { SiteShell } from '@/components/site-shell';
import { Hero } from '@/components/hero';
import { PresentationWidget, SimulationContext, type WidgetSimulation } from '@/components/exchange/presentation-widget';
import { PaymentMock } from '@/components/sections/payments';
import { resolveCaps } from '@/lib/capabilities';
import { humanize } from '@/lib/theme';
import { DEFAULT_PREVIEW, DESIGN_PREVIEW_ROOT, MSG_CONFIG, MSG_READY, SAMPLE_PAYMENT_METHODS, previewSite, samplePrice, sanitizeDesignPreview, type DesignPreviewConfig } from '@/lib/design-preview-bridge';

const BelowFold = lazy(() => import('@/components/below-fold'));
const SIM: WidgetSimulation = { price: samplePrice, paymentMethods: SAMPLE_PAYMENT_METHODS };

/** Receives design values only from the same-origin parent window. No network calls. */
function useBridgedConfig() {
  const [cfg, setCfg] = useState<DesignPreviewConfig>(DEFAULT_PREVIEW);
  useEffect(() => {
    if (window.parent === window) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: unknown; config?: unknown } | null;
      if (!d || d.type !== MSG_CONFIG) return;
      setCfg((prev) => sanitizeDesignPreview(d.config, prev));
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: MSG_READY }, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return cfg;
}

function Frame({ children }: { children: (site: ReturnType<typeof previewSite>) => ReactNode }) {
  const cfg = useBridgedConfig();
  const site = previewSite(cfg);
  return (
    <SimulationContext.Provider value={SIM}>
      <aside className="border-b bg-amber-50 p-2 text-center text-xs font-medium text-amber-950" data-testid="banner-design-preview">Design preview with synthetic sample data. Not a live site; no quotes, orders or transfers.</aside>
      <SiteShell key={`${cfg.theme}`} site={site} ambient>{children(site)}</SiteShell>
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
      <Narrow>
        <p className="s-eyebrow">Sample</p>
        <h1 className="s-h2 mt-3">{humanize(caps.exchangeKey ?? feature)}</h1>
        <p className="s-muted mt-4 text-lg leading-relaxed">Try Swap between fiat and crypto or Convert between two crypto assets. Every figure is a synthetic sample.</p>
        <div className="mt-10"><PresentationWidget key={feature} site={site} caps={caps} allowedActions={feature === 'swap' ? ['swap'] : feature === 'convert' ? ['convert'] : undefined} /></div>
        <div className="mt-10"><PaymentMock site={site} /></div>
        <p className="s-card mt-8 p-4 text-sm s-muted">This is a design preview. No orders, payments or transfers can be made here.</p>
        <Back />
      </Narrow>);
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
