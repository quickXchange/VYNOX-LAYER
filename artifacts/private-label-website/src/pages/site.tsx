import { lazy, Suspense, type ReactNode } from 'react';
import { useParams, Link } from 'wouter';
import { useGetPublicSite, getGetPublicSiteQueryKey, useGetPublicCapability, getGetPublicCapabilityQueryKey, type PublicSite } from '@workspace/api-client-react';
import { websitePreviewRequest } from '../lib/development-preview';
import { SiteShell, Unavailable, SiteSkeleton } from '@/components/site-shell';
import { Hero } from '@/components/hero';
import { ExchangeWidget } from '@/components/exchange-widget';
import { resolveCaps } from '@/lib/capabilities';
import { humanize } from '@/lib/theme';
import { SiteConfigContext, useReleasedSiteConfig } from '@/lib/site-config';

const BelowFold = lazy(() => import('@/components/below-fold'));

export function Gate({ slug, ambient, children }: { slug: string; ambient?: boolean; children: (s: PublicSite) => ReactNode }) {
  const q = useReleasedSiteConfig(slug);
  if (q.isLoading) return <SiteSkeleton />;
  if (q.isError || !q.data) return <Unavailable title="Site not found or unavailable" body={q.error?.message ?? 'This site has not been released.'} onRetry={() => void q.refetch()} />;
  return <SiteConfigContext.Provider value={q.data}>
    {q.data.site.preview && <aside className="border-b bg-amber-50 p-3 text-center text-sm font-medium text-amber-950" data-testid="banner-draft-preview">Preview, not live — only your authorized administrator session can see this draft.</aside>}
    <SiteShell key={q.data.site.tenantSlug} site={q.data.site} ambient={ambient}>{children(q.data.site)}</SiteShell>
  </SiteConfigContext.Provider>;
}

const BelowSkeleton = () => <div className="s-wrap py-20" aria-busy="true"><div className="s-skel h-8 w-64" /><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="s-skel h-28" /><div className="s-skel h-28" /><div className="s-skel h-28" /></div></div>;

export function SiteHome() {
  const { slug = '' } = useParams<{ slug: string }>();
  return <Gate slug={slug} ambient>{(site) => {
    const caps = resolveCaps(site);
    return <><Hero site={site} caps={caps} /><Suspense fallback={<BelowSkeleton />}><BelowFold site={site} caps={caps} /></Suspense></>;
  }}</Gate>;
}

function Narrow({ children, testid }: { children: ReactNode; testid?: string }) {
  return <div className="s-wrap s-rise py-16 md:py-24" data-testid={testid}><div className="mx-auto max-w-3xl">{children}</div></div>;
}

export function FeaturePage() {
  const { slug = '', feature = '' } = useParams<{ slug: string; feature: string }>();
  const cap = useGetPublicCapability(slug, feature, { request: websitePreviewRequest(slug), query: { enabled: !!slug && !!feature, queryKey: getGetPublicCapabilityQueryKey(slug, feature), retry: false } });
  return <Gate slug={slug}>{(site) => {
    const back = <Link href={`/${site.tenantSlug}`} className="s-btn s-btn-ghost mt-8" data-testid="link-back-home">Back to home</Link>;
    if (cap.isLoading) return <Narrow><div className="s-skel h-5 w-32" /><div className="s-skel mt-4 h-12 w-3/4" /><div className="s-skel mt-6 h-24 w-full" /></Narrow>;
    if (cap.isError || !cap.data || !site.features[feature]) return <Narrow testid="state-feature-unavailable"><p className="s-eyebrow">Not available</p><h1 className="s-h2 mt-3">This service is not enabled</h1><p className="s-muted mt-4">{humanize(feature)} is not enabled for {site.brandName}.</p>{back}</Narrow>;
    const caps = resolveCaps(site);
    const isExchange = feature === caps.exchangeKey;
    return (
      <Narrow>
        <p className="s-eyebrow" data-testid="text-capability-status">{cap.data.status}</p>
        <h1 className="s-h2 mt-3" data-testid="text-capability-title">{humanize(cap.data.feature)}</h1>
        <p className="s-muted mt-4 text-lg leading-relaxed" data-testid="text-capability-message">{cap.data.message}</p>
        {isExchange && <div className="mt-10"><ExchangeWidget site={site} caps={caps} /></div>}
        <p className="s-card mt-8 p-4 text-sm s-muted">This is a sandbox preview. No orders, payments or transfers can be made here.</p>
        {back}
      </Narrow>
    );
  }}</Gate>;
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { slug = '' } = useParams<{ slug: string }>();
  return <Gate slug={slug}>{(site) => {
    const text = kind === 'privacy' ? site.websiteSettings.privacyContent : site.websiteSettings.termsContent;
    return (
      <Narrow>
        <p className="s-eyebrow">{site.brandName}</p>
        <h1 className="s-h2 mt-3">{kind === 'privacy' ? 'Privacy policy' : 'Terms of service'}</h1>
        {text.trim()
          ? <div className="mt-8 whitespace-pre-wrap break-words text-[1.02rem] leading-[1.75]" data-testid={`text-${kind}`}>{text}</div>
          : <p className="s-card mt-8 p-5 s-muted" data-testid={`text-${kind}-empty`}>{site.brandName} has not published this document yet.</p>}
        <Link href={`/${site.tenantSlug}`} className="s-btn s-btn-ghost mt-10">Back to home</Link>
      </Narrow>
    );
  }}</Gate>;
}
