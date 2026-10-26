import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Entry from '@/pages/entry';
import { SiteHome, FeaturePage, LegalPage } from '@/pages/site';
import NotFound from '@/pages/not-found';
import { DesignPreviewHome, DesignPreviewFeature, DesignPreviewLegal } from '@/pages/design-preview';
import { DesignPreviewAdmin } from '@/pages/design-preview-admin';
const TelegramMini = lazy(() => import('@/pages/telegram-mini'));
const OrderTracking = lazy(() => import('@/pages/order-tracking'));
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, gcTime: 60_000, refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: true } } });

function MainPlatformEntry() {
  // Cross-artifact navigation: the main platform is registered at /,
  // while this router handles only /private-label-website/.
  useEffect(() => { window.location.replace('/'); }, []);
  return <a href="/">Open VYNOX LAYER Main Platform</a>;
}

function RouteScroll() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const scroll = () => {
      const target = document.getElementById(id);
      if (!target) return false;
      // Route anchors wait for actual query/lazy content, not an arbitrary delay.
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      return true;
    };
    if (scroll()) return;
    const observer = new MutationObserver(() => {
      if (scroll()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 8000);
    return () => { observer.disconnect(); window.clearTimeout(timeout); };
  }, [location]);
  return null;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={MainPlatformEntry} />
        <Route path="/sandbox/site-finder" component={Entry} />
        <Route path="/__design-preview" component={DesignPreviewHome} />
        <Route path="/__design-preview/admin" component={DesignPreviewAdmin} />
        <Route path="/__design-preview/admin/orders/:ref" component={DesignPreviewAdmin} />
        <Route path="/__design-preview/admin/:section" component={DesignPreviewAdmin} />
        <Route path="/__design-preview/privacy">{() => <DesignPreviewLegal kind="privacy" />}</Route>
        <Route path="/__design-preview/terms">{() => <DesignPreviewLegal kind="terms" />}</Route>
        <Route path="/__design-preview/:feature" component={DesignPreviewFeature} />
        <Route path="/:slug/orders/:orderId">{() => <Suspense fallback={null}><OrderTracking /></Suspense>}</Route>
        <Route path="/:slug" component={SiteHome} />
        <Route path="/:slug/privacy">{() => <LegalPage kind="privacy" />}</Route>
        <Route path="/:slug/terms">{() => <LegalPage kind="terms" />}</Route>
        <Route path="/:slug/telegram">{() => <Suspense fallback={null}><TelegramMini /></Suspense>}</Route>
        <Route path="/:slug/:feature" component={FeaturePage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RouteScroll />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
