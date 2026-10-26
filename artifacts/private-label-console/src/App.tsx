import { lazy, Suspense, useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { Show, useAccountAuth } from '@/lib/auth';
import { authClient, ownedAuth, supabaseAuth } from '@/lib/owned-auth-client';
import { registerSupabaseQueryClient } from '@/lib/supabase-auth-client';
import { StagingAuthHistorySync } from '@/components/auth/staging-auth-navigation';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useGetCurrentPrincipal, getGetCurrentPrincipalQueryKey, useGetDemoSession, getGetDemoSessionQueryKey, endDemoSession } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
const AdminShell = lazy(() => import('@/components/app/shell').then(m => ({ default: m.AdminShell })));
import { PrincipalContext, usePrincipal } from '@/lib/principal';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
const DemoAdmin = lazy(() => import('@/pages/demo-admin'));
const CustomerShell = lazy(() => import('@/components/app/customer-shell').then(m => ({ default: m.CustomerShell })));
import { RoutePrefetch } from '@/components/app/route-prefetch';
import { useAdminPanels } from '@/lib/customer';
const AccountDashboard = lazy(() => import('@/pages/account').then(m => ({ default: m.AccountDashboard })));
const AccountOrders = lazy(() => import('@/pages/account').then(m => ({ default: m.AccountOrders })));
const AccountWhiteLabels = lazy(() => import('@/pages/account').then(m => ({ default: m.AccountWhiteLabels })));
const AdminPanels = lazy(() => import('@/pages/account').then(m => ({ default: m.AdminPanels })));
const ConfigureExchange = lazy(() => import('@/pages/account').then(m => ({ default: m.ConfigureExchange })));
const AbracadabraPreview = lazy(() => import('@/pages/abracadabra-preview'));
const AccountProfile = lazy(() => import('@/pages/account').then(m => ({ default: m.AccountProfile })));
const NotProvisioned = lazy(() => import('@/pages/account').then(m => ({ default: m.NotProvisioned })));
const WhiteLabelRequests = lazy(() => import('@/pages/white-label-requests'));
const WhiteLabelOrder = lazy(() => import('@/pages/white-label-order'));
const AccountOrderDetail = lazy(() => import('@/pages/account-order'));
import { Link, useParams } from 'wouter';
const Admin = lazy(() => import('@/pages/admin'));
const Clients = lazy(() => import('@/pages/clients'));
const ClientNew = lazy(() => import('@/pages/client-new'));
const ClientDetail = lazy(() => import('@/pages/client-detail'));
const Exchange = lazy(() => import('@/pages/exchange'));
const Modules = lazy(() => import('@/pages/modules'));
const Activity = lazy(() => import('@/pages/activity'));
const WhiteLabels = lazy(() => import('@/pages/white-labels'));
const CustomerDomains = lazy(() => import('@/pages/customer-domains'));
const Provisioning = lazy(() => import('@/pages/provisioning'));
const Integrations = lazy(() => import('@/pages/integrations'));
const TenantIntegrations = lazy(() => import('@/pages/integrations').then(m => ({ default: m.TenantIntegrations })));
const GlobalCatalog = lazy(() => import('@/pages/global-catalog'));
const Providers = lazy(() => import('@/pages/providers'));
const CustomerDetail = lazy(() => import('@/pages/customer-detail'));
const Plans = lazy(() => import('@/pages/plans'));
const PlanDetail = lazy(() => import('@/pages/plan-detail'));
const Addons = lazy(() => import('@/pages/addons'));
const LandingProducts = lazy(() => import('@/pages/landing-products'));
const ProductExplore = lazy(() => import('@/pages/product-explore'));
const CatalogPreview = lazy(() => import('@/pages/catalog-preview'));
import { BrandLogo } from '@/components/brand-logo';
import { ConsoleThemeScope } from '@/components/app/console-frame';
import { resetAccountQueries } from '@/lib/auth-query-transition';
import { setRequestTimeout } from '@workspace/api-client-react';

const externalStaging = import.meta.env.VITE_EXTERNAL_DEPLOYMENT === "true" &&
    import.meta.env.VITE_QXLAYER_EXTERNAL_ENVIRONMENT === "staging";
if (externalStaging) setRequestTimeout(20000);

const queryClient = new QueryClient({ defaultOptions: { queries: {
  retry: externalStaging ? false : 1,
  networkMode: externalStaging ? 'always' : 'online',
  refetchOnWindowFocus: false,
} } });

registerSupabaseQueryClient(queryClient);
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function OwnedCacheInvalidator() {
  const qc = useQueryClient();
  const s = authClient.useSession();
  const prev = useRef<string | null | undefined>(undefined);
  const id = s.isPending || s.error ? undefined : (s.data?.user?.id ?? null);
  useEffect(() => {
    if (id === undefined) return;
    if (prev.current !== undefined && prev.current !== id) void resetAccountQueries(qc);
    prev.current = id;
  }, [id, qc]);
  return null;
}

function HomeRedirect() {
  return <Home />;
}

function PrincipalGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const q = useGetCurrentPrincipal({ query: { queryKey: getGetCurrentPrincipalQueryKey(),
    retry: (count, error) => ![401, 403, 428].includes((error as { status?: number }).status ?? 0) && count < 1,
    refetchInterval: query => externalStaging && query.state.error ? false : 10000 } });
  const { signOut } = useAccountAuth();
  const qc = useQueryClient();
  let demoTab = false;
  try { demoTab = sessionStorage.getItem('qx-isolated-demo') === 'read-only'; } catch { /* no demo intent */ }
  const leave = async () => {
    if (!demoTab) { await signOut({ redirectUrl: '/' }); return; }
    try { await endDemoSession(); } finally {
      sessionStorage.removeItem('qx-isolated-demo'); qc.clear();
      window.location.assign(import.meta.env.BASE_URL);
    }
  };
  if ((q.error as { status?: number } | null)?.status === 428) return <Redirect to="/account/security" replace={supabaseAuth} />;
  if (q.isLoading) return <ConsoleThemeScope><div className="space-y-3 p-10"><BrandLogo size={48} /><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" />{supabaseAuth && <Link href="/account/security" className="inline-block text-sm underline" data-testid="link-pending-security">Account security and two-factor setup</Link>}</div></ConsoleThemeScope>;
  if (demoTab && q.data && !q.data.demo) return <ConsoleThemeScope><Skeleton className="m-10 h-64" /></ConsoleThemeScope>;
  if (q.isError || !q.data) {
    return (
      <ConsoleThemeScope><div className="grid min-h-[100dvh] place-items-center px-5 text-center">
        <div className="space-y-3"><BrandLogo size={48} className="mx-auto" /><p className="font-display text-3xl">Could not verify your access</p>
          <div className="flex justify-center gap-2"><Button data-testid="button-retry" onClick={() => q.refetch()}>Retry</Button>
            <Button variant="ghost" onClick={() => void leave()}>{demoTab ? 'Exit demo' : 'Sign out'}</Button></div></div>
      </div></ConsoleThemeScope>
    );
  }
  if (q.data.demo) {
    const tenantId = q.data.memberships?.[0]?.tenantId;
    if (!tenantId) return <Redirect to="/demo/admin" />;
    const allowed = `/clients/${tenantId}/exchange`;
    if (location !== allowed && !location.startsWith(`${allowed}/`)) return <Redirect to={allowed} />;
  }
  return (
    <PrincipalContext.Provider value={q.data}>
      <RoutePrefetch />
      {q.data.role === 'super_admin' ? <AdminShell>{children}</AdminShell> : <CustomerShell>{children}</CustomerShell>}
    </PrincipalContext.Provider>
  );
}

function Protected({ children }: { children: ReactNode }) {
  let demoTab = false;
  try { demoTab = sessionStorage.getItem("qx-isolated-demo") === "read-only"; } catch { /* no demo context */ }
  const demo = useGetDemoSession({ query: { queryKey: getGetDemoSessionQueryKey(), enabled: demoTab, retry: false, staleTime: 0, refetchInterval: 60000 } });
  if (demoTab && demo.error) return <Redirect to="/demo/admin" />;
  if (demoTab && demo.data?.active) return <PrincipalGate>{children}</PrincipalGate>;
  if (demoTab && demo.isLoading) return <ConsoleThemeScope><Skeleton className="m-10 h-64" /></ConsoleThemeScope>;
  if (ownedAuth && !demoTab) return <OwnedProtected>{children}</OwnedProtected>;
  return (
    <>
      <Show when="signed-in"><PrincipalGate>{children}</PrincipalGate></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}
function OwnedProtected({ children }: { children: ReactNode }) {
  const s = authClient.useSession();
  if (s.error) return <ConsoleThemeScope><ErrorState what="your session" onRetry={() => void s.refetch()} /><Button variant="outline" onClick={() => window.location.reload()}>Reload private access</Button></ConsoleThemeScope>;
  if (s.isPending) return <ConsoleThemeScope><Skeleton className="m-10 h-64" /></ConsoleThemeScope>;
  if (!s.data?.user) return <Redirect to={(s as { mfaRequired?: boolean }).mfaRequired ? '/two-factor' : '/sign-in'} replace={supabaseAuth} />;
  return <PrincipalGate>{children}</PrincipalGate>;
}
function SuperOnly({ children }: { children: ReactNode }) {
  const p = usePrincipal();
  return p.role === 'super_admin' ? <>{children}</> : <Redirect to="/account" replace={supabaseAuth} />;
}
function DeliveredOnly({ children }: { children: ReactNode }) {
  const p = usePrincipal(); const { id = '' } = useParams<{ id: string }>();
  const a = useAdminPanels(!p.demo && p.role !== 'super_admin');
  // Isolated demo access is not a delivered customer assignment. Its server
  // fixture boundary is authoritative and it must not read account endpoints.
  if (p.demo) return p.memberships?.some(m => m.tenantId === id) ? <>{children}</> : <NotProvisioned />;
  if (p.role === 'super_admin') return <>{children}</>;
  if (a.isLoading) return <Skeleton className="h-64 w-full" />;
  if (a.isError) return <ErrorState what="your admin panels" onRetry={() => a.refetch()} />;
  return a.data?.some((x) => x.tenantId === id) ? <>{children}</> : <NotProvisioned />;
}
const guard = (C: ComponentType) => () => <Protected><SuperOnly><C /></SuperOnly></Protected>;
const open = (C: ComponentType) => () => <Protected><C /></Protected>;
const rTenantInt = () => <Protected><DeliveredOnly><TenantIntegrations /></DeliveredOnly></Protected>;
const rDelivered = () => <Protected><DeliveredOnly><Exchange /></DeliveredOnly></Protected>;
const rAdmin = guard(Admin), rClients = guard(Clients), rNew = guard(ClientNew), rDetail = guard(ClientDetail), rModules = guard(Modules), rActivity = guard(Activity), rPlans = guard(Plans), rPlan = guard(PlanDetail), rAddons = guard(Addons), rLanding = guard(LandingProducts), rWL = guard(WhiteLabelRequests), rWLO = guard(WhiteLabelOrder), rWLs = guard(WhiteLabels), rCD = guard(CustomerDomains), rProv = guard(Provisioning), rProviders = guard(Providers), rGCat = guard(GlobalCatalog), rInt = guard(Integrations), rCust = guard(CustomerDetail);
const rAcc = open(AccountDashboard), rOrd = open(AccountOrders), rWls = open(AccountWhiteLabels), rPanels = open(AdminPanels), rCfg = open(ConfigureExchange), rProf = open(AccountProfile), rOrdD = open(AccountOrderDetail), rAbracadabra = guard(AbracadabraPreview);

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Suspense fallback={<div className="p-6"><Skeleton className="h-64 w-full" /></div>}>{children}</Suspense></ErrorBoundary>;
}

const OwnedSignIn = lazy(() => import('@/pages/sign-in'));
const OwnedSignUp = lazy(() => import('@/pages/sign-up'));
const OwnedForgot = lazy(() => import('@/pages/forgot-password'));
const OwnedReset = lazy(() => import('@/pages/reset-password'));
const OwnedVerify = lazy(() => import('@/pages/verify-email'));
const OwnedTwoFactor = lazy(() => import('@/pages/two-factor'));
const OwnedSecurity = lazy(() => import('@/pages/account-security'));

function AppRoutes() {
  return (
  <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/demo/admin" component={DemoAdmin} />
              <Route path="/products/:productKey" component={ProductExplore} />
              <Route path="/pricing">{() => <Redirect to="/products/crypto_exchange#pricing" replace />}</Route>
              <Route path="/contact">{() => <Redirect to={`/account/configure${window.location.search}`} replace />}</Route>
              {ownedAuth && <Route path="/sign-in" component={OwnedSignIn} />}
              {ownedAuth && <Route path="/sign-up" component={OwnedSignUp} />}
              {ownedAuth && <Route path="/forgot-password" component={OwnedForgot} />}
              {ownedAuth && <Route path="/reset-password" component={OwnedReset} />}
              {ownedAuth && <Route path="/verify-email" component={OwnedVerify} />}
              {ownedAuth && <Route path="/two-factor" component={OwnedTwoFactor} />}
              {ownedAuth && <Route path="/account/security" component={OwnedSecurity} />}
              <Route path="/account" component={rAcc} />
              <Route path="/account/orders" component={rOrd} />
              <Route path="/account/orders/:orderId" component={rOrdD} />
              <Route path="/account/white-labels" component={rWls} />
              <Route path="/account/admin-panels" component={rPanels} />
              <Route path="/account/configure" component={rCfg} />
              <Route path="/account/profile/*?" component={rProf} />
              <Route path="/white-label-requests" component={rWL} />
              <Route path="/white-label-requests/:orderId" component={rWLO} />
              <Route path="/white-labels" component={rWLs} />
              <Route path="/customer-domains" component={rCD} />
              <Route path="/provisioning" component={rProv} />
              <Route path="/providers" component={rProviders} />
              <Route path="/exchange-catalog" component={rGCat} />
              <Route path="/integrations" component={rInt} />
              <Route path="/customers/:customerId" component={rCust} />
              <Route path="/admin" component={rAdmin} />
              <Route path="/clients" component={rClients} />
              <Route path="/clients/new" component={rNew} />
              <Route path="/clients/:id/exchange/:section?/:orderId?" component={rDelivered} />
              <Route path="/clients/:id/integrations" component={rTenantInt} />
              <Route path="/clients/:id" component={rDetail} />
              <Route path="/modules" component={rModules} />
              <Route path="/plans" component={rPlans} />
              <Route path="/plans/new" component={rPlan} />
              <Route path="/plans/:id" component={rPlan} />
              <Route path="/add-ons" component={rAddons} />
              <Route path="/landing-products" component={rLanding} />
              <Route path="/catalog-preview" component={CatalogPreview} />
              <Route path="/abracadabra-preview" component={rAbracadabra} />
              <Route path="/activity" component={rActivity} />
              <Route component={NotFound} />
            </Switch>
  );
}

function OwnedProviderWithRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <OwnedCacheInvalidator />
        {supabaseAuth
          ? <StagingAuthHistorySync><RoutedErrorBoundary><AppRoutes /></RoutedErrorBoundary></StagingAuthHistorySync>
          : <RoutedErrorBoundary><AppRoutes /></RoutedErrorBoundary>}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <OwnedProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
