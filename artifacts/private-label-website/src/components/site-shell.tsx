import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import { LifeBuoy, Menu, Moon, Sun, X } from 'lucide-react';
import type { PublicSite } from '@workspace/api-client-react';
import { tokens, themeColorMeta } from '../lib/theme';
import { navItems, primaryCta, resolveCaps } from '../lib/capabilities';
import { useAnchors } from '../lib/anchors';
import { useSiteTheme } from '../hooks/use-site-theme';
import { useDocumentMeta } from '../hooks/use-document-meta';
import { useCurrentSiteConfig } from '../lib/site-config';
import { Ambient } from './ambient';

export function BrandMark({ site, size = 32 }: { site: PublicSite; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [site.tenantSlug, site.logoUrl]);
  if (site.logoUrl && !broken) return <img src={site.logoUrl} alt="" width={size} height={size} onError={() => setBroken(true)} style={{ height: size, maxWidth: size * 4 }} className="object-contain" />;
  return <span aria-hidden="true" className="grid place-items-center font-bold" style={{ width: size, height: size, borderRadius: 'var(--s-r1)', background: 'var(--s-primary)', color: 'var(--s-primary-fg)' }}>{site.brandName.slice(0, 1).toUpperCase()}</span>;
}

function supportHref(site: PublicSite, anchor: (id: string) => string) {
  const ws = site.websiteSettings;
  if (ws.supportUrl) return { href: ws.supportUrl, external: true };
  if (ws.supportEmail) return { href: `mailto:${ws.supportEmail}`, external: false };
  return { href: anchor('support'), external: false, anchor: true };
}

export interface PlatformShell { root: string; nav: { id: string; label: string }[]; actions: ReactNode; footer: ReactNode; headerBrand?: ReactNode; lightLogoUrl?: string; lightFaviconUrl?: string }

export function SiteShell({ site, children, ambient = false, platform }: { site: PublicSite; children: ReactNode; ambient?: boolean; platform?: PlatformShell }) {
  const { dark, toggle } = useSiteTheme(site);
  const t = tokens(site, dark);
  const themedSite = platform && !dark ? {
    ...site,
    logoUrl: platform.lightLogoUrl ?? site.logoUrl,
    websiteSettings: { ...site.websiteSettings, faviconUrl: platform.lightFaviconUrl ?? site.websiteSettings.faviconUrl },
  } : site;
  useDocumentMeta(themedSite, themeColorMeta(site, dark));
  const caps = resolveCaps(site);
  const nav = platform?.nav ?? navItems(site, caps);
  const cta = primaryCta(caps);
  const { href, go } = useAnchors(site.tenantSlug, platform?.root);
  const ws = site.websiteSettings;
  const base = platform?.root ?? `/${site.tenantSlug}`;
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', k);
    panel.current?.querySelector<HTMLElement>('a,button')?.focus();
    return () => document.removeEventListener('keydown', k);
  }, [open]);
  const sup = supportHref(site, (id) => href(id));
  const supportLink = (cls: string, label: string, after?: () => void) => 'anchor' in sup
    ? <a href={sup.href} onClick={go('support', after)} className={cls} data-testid="link-support">{label}</a>
    : <a href={sup.href} className={cls} data-testid="link-support" {...(sup.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{label}</a>;
  const close = () => setOpen(false);
  return (
    <div className="site min-h-[100dvh]" style={t as CSSProperties} data-exchange-template={platform ? undefined : ws.templateKey ?? 'standard-exchange'} data-qx-theme={platform ? (dark ? 'dark' : 'light') : undefined} data-surface={ws.surfaceStyle ?? 'solid'} data-testid="site-root">
      {ambient && <Ambient />}
      <header className={`s-header${platform ? ' s-platform-header' : ''}`}>
        <div className="s-wrap flex h-[68px] items-center gap-3">
          <Link href={base} className={`flex min-w-0 items-center gap-2.5${platform?.headerBrand ? ' shrink-0' : ''}`} data-testid="link-home">
            {platform?.headerBrand ?? <><BrandMark site={themedSite} />
              <span className="truncate text-[1.05rem] font-semibold tracking-tight" data-testid="text-brand">{ws.websiteName || site.brandName}</span></>}
          </Link>
          <nav className="s-nav ml-6 hidden flex-1 items-center gap-0.5 lg:flex" aria-label="Primary">
            {nav.map((n) => <a key={n.id} href={href(n.id)} onClick={go(n.id)} data-testid={`link-nav-${n.id}`}>{n.label}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <button type="button" onClick={toggle} className="s-iconbtn" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={dark} data-testid="button-theme">
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="hidden lg:block">{platform ? <span className="flex gap-2">{platform.actions}</span> : supportLink('s-btn s-btn-ghost', 'Support')}</span>
            <a href={href(cta.id)} onClick={go(cta.id)} className="s-btn s-btn-primary s-header-cta" data-testid="link-header-cta">{cta.label}</a>
            <button ref={menuBtn} type="button" className="s-iconbtn s-menu-trigger" aria-expanded={open} aria-controls="s-mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((v) => !v)} data-testid="button-menu">
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <div id="s-mobile-menu" ref={panel} className="s-mobile-menu border-t lg:hidden" style={{ borderColor: 'var(--s-line)', background: 'var(--s-bg)' }}>
            <nav className="s-wrap flex flex-col gap-1 py-3" aria-label="Mobile">
              {nav.map((n) => <a key={n.id} href={href(n.id)} onClick={go(n.id, close)} className="flex min-h-[48px] items-center rounded-md px-3 text-base font-medium hover:bg-[color-mix(in_srgb,var(--s-fg)_6%,transparent)]" data-testid={`link-mobile-${n.id}`}>{n.label}</a>)}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <a href={href(cta.id)} onClick={go(cta.id, close)} className="s-btn s-btn-primary s-menu-cta">{cta.label}</a>
                {platform ? <span className="grid gap-2">{platform.actions}</span> : supportLink('s-btn s-btn-ghost', 'Support', close)}
              </div>
            </nav>
          </div>
        )}
      </header>
      <main className="relative z-[2]">{children}</main>
      {platform ? platform.footer : <Footer site={site} nav={nav} />}
    </div>
  );
}

function Footer({ site, nav }: { site: PublicSite; nav: { id: string; label: string }[] }) {
  const snapshot = useCurrentSiteConfig();
  const ws = site.websiteSettings;
  const base = `/${site.tenantSlug}`;
  const { href, go } = useAnchors(site.tenantSlug);
  const hasSupport = !!(ws.supportEmail || ws.supportUrl || ws.supportDetails.trim());
  const col = 'mb-3 text-xs font-semibold uppercase tracking-[0.14em]';
  const lk = 'block py-1.5 text-sm s-muted transition-colors hover:text-[var(--s-fg)]';
  return (
    <footer id="support" className="s-footer relative z-[2] mt-10 border-t" style={{ borderColor: 'var(--s-line)', background: 'var(--s-bg2)' }}>
      <div className="s-wrap grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5"><BrandMark site={site} size={30} /><span className="text-lg font-semibold tracking-tight">{site.brandName}</span></div>
          {ws.footerText.trim() && <p className="s-muted mt-4 max-w-sm whitespace-pre-line text-sm leading-relaxed" data-testid="text-footer">{ws.footerText}</p>}
          {!!snapshot?.addons.length && <p className="s-muted mt-3 text-xs" data-testid="text-released-addons">Enabled add-ons: {snapshot.addons.map(a => a.name).join(', ')}</p>}
        </div>
        <div><p className={col}>Navigate</p>{nav.map((n) => <a key={n.id} href={href(n.id)} onClick={go(n.id)} className={lk}>{n.label}</a>)}</div>
        <div><p className={col}>Support</p>
          {hasSupport ? <>
            {ws.supportEmail && <a className={lk} href={`mailto:${ws.supportEmail}`}>{ws.supportEmail}</a>}
            {ws.supportUrl && <a className={lk} href={ws.supportUrl} target="_blank" rel="noreferrer noopener">Help center</a>}
            {ws.supportDetails.trim() && <p className="s-muted mt-1 whitespace-pre-line text-sm">{ws.supportDetails}</p>}
          </> : <p className="s-muted flex items-center gap-2 text-sm"><LifeBuoy size={15} />No support channel configured yet.</p>}
        </div>
        <div><p className={col}>Legal and social</p>
          <Link href={`${base}/privacy`} className={lk} data-testid="link-privacy">Privacy policy</Link>
          <Link href={`${base}/terms`} className={lk} data-testid="link-terms">Terms of service</Link>
          {ws.socialLinks.map((l) => <a key={l.url} className={lk} href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a>)}
          {(ws.reviewLinks ?? []).map((l, i) => <a key={`review-${i}`} className={lk} href={l.url} target="_blank" rel="noreferrer noopener" data-testid={`link-review-${i}`}>{l.label}</a>)}
        </div>
      </div>
      <div className="border-t" style={{ borderColor: 'var(--s-line)' }}>
        <div className="s-wrap flex flex-col gap-1 py-5 text-xs s-muted sm:flex-row sm:justify-between">
          <span>{site.brandName}</span>
          {site.sandboxOnly && <span className="s-mono uppercase tracking-widest">Sandbox environment - no real funds move here</span>}
        </div>
      </div>
    </footer>
  );
}

export function Unavailable({ title = 'This site is unavailable', body = 'It may not exist, or it is not currently published to the public.', onRetry }: { title?: string; body?: string; onRetry?: () => void }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center" data-testid="state-unavailable">
      <div className="max-w-md space-y-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Unavailable</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{body}</p>
        <div className="flex justify-center gap-2">
          {onRetry && <button type="button" onClick={onRetry} className="h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground" data-testid="button-retry">Try again</button>}
          <a href={import.meta.env.BASE_URL} className="inline-flex h-11 items-center rounded-md border px-5 text-sm font-medium">Find another site</a>
        </div>
      </div>
    </div>
  );
}

export function SiteSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-background" aria-busy="true" aria-label="Loading site" data-testid="state-loading">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center gap-3 px-5"><div className="h-8 w-8 animate-pulse rounded bg-muted" /><div className="h-4 w-28 animate-pulse rounded bg-muted" /></div>
      <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-16 lg:grid-cols-2">
        <div className="space-y-4"><div className="h-6 w-40 animate-pulse rounded-full bg-muted" /><div className="h-16 w-full animate-pulse rounded bg-muted" /><div className="h-16 w-4/5 animate-pulse rounded bg-muted" /><div className="h-5 w-3/5 animate-pulse rounded bg-muted" /></div>
        <div className="h-[440px] animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
