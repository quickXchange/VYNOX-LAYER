import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ChevronDown, Info, ShieldCheck } from 'lucide-react';
import type { ExchangeOrderReview, ExchangeQuote, PublicSite } from '@workspace/api-client-react';
import { useGetPublicExchange, getGetPublicExchangeQueryKey, createSandboxQuote, createSandboxOrder, reviewSandboxOrder } from '@workspace/api-client-react';
import { websitePreviewRequest } from '../../lib/development-preview';
import { useCurrentSiteConfig } from '../../lib/site-config';
import type { Caps, ExchangeTab } from '../../lib/capabilities';
import { AMOUNT, buildPairs, isTab, uniqueOptions, type Option, type Pair } from '../../lib/exchange-model';
import { EMPTY_DETAILS, toCustomerDetails, validateDetails, type DetailsForm, type PayoutKind } from '../../lib/exchange-details';
import type { RateInfo } from './types';
import { OptionLogo } from './option-logo';
import { OptionPicker } from './option-picker';
import { QuotePanel } from './quote-panel';
import { DetailsStep } from './details-step';
import { ReviewStep } from './review-step';
import { WidgetShell } from './widget-shell';

const LABEL: Record<ExchangeTab, string> = { swap: 'Swap', convert: 'Convert' };
type Step = 'exchange' | 'details' | 'review';
const STEPS: { id: Step; label: string }[] = [{ id: 'exchange', label: 'Exchange' }, { id: 'details', label: 'Customer details' }, { id: 'review', label: 'Review' }];
const validQuote = (q: ExchangeQuote | null): q is ExchangeQuote => !!q && new Date(q.expiresAt).getTime() > Date.now();

function resolvePair(pairs: Pair[], fromKey: string | null, toKey: string | null, def?: { source: string; destination: string; paymentMethodId?: string }): Pair | null {
  const exact = pairs.find((p) => p.from.key === fromKey && p.to.key === toKey);
  if (exact) return exact;
  const byFrom = pairs.find((p) => p.from.key === fromKey);
  if (byFrom) return byFrom;
  if (def) {
    const d = pairs.find((p) => p.from.endpoint === def.source && p.to.endpoint === def.destination && (!def.paymentMethodId || (p.from.method ?? p.to.method)?.id === def.paymentMethodId));
    if (d) return d;
  }
  return pairs[0] ?? null;
}

function Side({ id, label, option, value, onValue, readOnly, onPick, error, disabled }: { id: string; label: string; option: Option | null; value: string; onValue?: (v: string) => void; readOnly?: boolean; onPick: () => void; error?: string | null; disabled?: boolean }) {
  return (
    <div>
      <div className={`s-side${readOnly ? ' s-side-out' : ''}`} style={error ? { borderColor: '#d9485f' } : undefined}>
        <label htmlFor={`amt-${id}`} className="s-lab">{label}</label>
        <div className="mt-1.5 flex items-center gap-3">
          <input id={`amt-${id}`} className="s-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={value} readOnly={readOnly} aria-invalid={!!error} onChange={(e) => { const v = e.target.value.replace(',', '.'); if (AMOUNT.test(v)) onValue?.(v); }} data-testid={`input-amount-${id}`} />
          <button type="button" className="s-pick" onClick={onPick} disabled={disabled} aria-haspopup="dialog" aria-label={`${label}: choose${option ? `, ${option.title}` : ''}`} data-testid={`button-option-${id}`}>
            {option ? <OptionLogo option={option} size={52} /> : <span className="s-coin" style={{ width: 52, height: 52, background: 'var(--s-secondary)' }}>?</span>}
            <span className="truncate">{option ? (option.kind === 'fiat' ? option.title : option.symbol) : 'Select'}</span><ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="s-muted mt-2 min-h-[22px] truncate text-xs" data-testid={`text-option-${id}`}>{option ? option.kind === 'fiat' ? `${option.symbol} via ${option.title}` : option.subtitle : 'Nothing selected'}</div>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs font-medium" style={{ color: '#e5556b' }}>{error}</p>}
    </div>
  );
}

export function LiveWidget({ site, caps, allowedActions, initialAction, onRateInfo }: { site: PublicSite; caps: Caps; allowedActions?: ExchangeTab[]; initialAction?: ExchangeTab; onRateInfo?: (info: RateInfo) => void }) {
  const snapshot = useCurrentSiteConfig();
  const networkExchangeQ = useGetPublicExchange(site.tenantSlug, { request: websitePreviewRequest(site.tenantSlug), query: { enabled: !snapshot, queryKey: getGetPublicExchangeQueryKey(site.tenantSlug), refetchInterval: snapshot ? false : 15000 } });
  const exchangeQ = snapshot ? { ...networkExchangeQ, data: snapshot.exchange ?? undefined, isLoading: false, isError: !snapshot.exchange } : networkExchangeQ;
  const config = exchangeQ.data;
  const allTabs = config ? config.actions.filter(isTab) : [];
  const tabs = allowedActions ? allTabs.filter((t) => allowedActions.includes(t)) : allTabs;
  const previewProof = useMemo(() => !!websitePreviewRequest(site.tenantSlug).headers, [site.tenantSlug]);
  const loadingCfg = exchangeQ.isLoading;
  const errorCfg = !loadingCfg && exchangeQ.isError;
  const inactive = loadingCfg || errorCfg || !config?.enabled || !config.actions.length || previewProof;

  const [tabState, setTab] = useState<ExchangeTab | null>(initialAction ?? null);
  const tab: ExchangeTab = tabState && tabs.includes(tabState) ? tabState : initialAction && tabs.includes(initialAction) ? initialAction : config?.defaultAction && isTab(config.defaultAction) && tabs.includes(config.defaultAction) ? config.defaultAction : tabs[0] ?? caps.tabs[0] ?? 'swap';
  const [step, setStep] = useState<Step>('exchange');
  const [fromKey, setFromKey] = useState<string | null>(null);
  const [toKey, setToKey] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshQuote, setRefreshQuote] = useState(0);
  const [form, setForm] = useState<DetailsForm>(EMPTY_DETAILS);
  const [review, setReview] = useState<ExchangeOrderReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idempotency = useRef(crypto.randomUUID());
  const revision = useRef(0);
  const attempted = useRef<{ fingerprint: string; payload: Parameters<typeof createSandboxOrder>[1] } | null>(null);

  const pairs = useMemo(() => buildPairs(config, tab), [config, tab]);
  const pair = useMemo(() => resolvePair(pairs, fromKey, toKey, config?.defaultPairs?.[tab]), [pairs, fromKey, toKey, config, tab]);
  const fromOptions = useMemo(() => uniqueOptions(pairs.map((p) => p.from)), [pairs]);
  const toOptions = useMemo(() => uniqueOptions(pairs.filter((p) => p.from.key === pair?.from.key).map((p) => p.to)), [pairs, pair]);
  const method = (pair?.from.method ?? pair?.to.method) ?? undefined;
  const kind: PayoutKind = pair?.to.kind === 'fiat' ? 'bank' : 'wallet';
  const requirements={iban:method?.receivingIbanRequired,memo:pair?.to.asset?.memoRequired};
  const amountError = touched && (amount === '' || Number(amount) <= 0) ? 'Enter an amount greater than zero.' : null;

  const reset = useCallback(() => { revision.current++; setQuote(null); setStatus(null); setStep('exchange'); attempted.current = null; idempotency.current = crypto.randomUUID(); }, []);
  const changeTab = (t: ExchangeTab) => { setTab(t); setFromKey(null); setToKey(null); setTouched(false); reset(); };
  useEffect(() => { if (initialAction && tabs.includes(initialAction)) { setTab(initialAction); setFromKey(null); setToKey(null); setTouched(false); reset(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initialAction]);

  const rateCb = useRef(onRateInfo);
  rateCb.current = onRateInfo;
  useEffect(() => {
    rateCb.current?.({ mode: tab, sourceAsset: pair?.from.symbol ?? null, targetAsset: pair?.to.symbol ?? null, rate: quote?.rate ?? null, loading: quoting, error: !!status && !quote && !quoting });
  }, [quote, quoting, status, tab, pair]);

  const pairFrom = pair?.from.key, pairTo = pair?.to.key;
  useEffect(() => {
    setQuote(null); setQuoting(false);
    if (inactive || !pair || !amount || Number(amount) <= 0 || !tabs.includes(tab)) return;
    const controller = new AbortController();
    const current = ++revision.current;
    const timer = setTimeout(() => {
      setQuoting(true);
      const pm = pair.from.method?.id ?? pair.to.method?.id;
      createSandboxQuote(site.tenantSlug, { action: tab, source: pair.from.endpoint, destination: pair.to.endpoint, amount, ...(tab === 'swap' && pm ? { paymentMethodId: pm } : {}) }, { signal: controller.signal })
        .then((q) => { if (!controller.signal.aborted && current === revision.current) { setQuote(q); setStatus(null); idempotency.current = crypto.randomUUID(); } })
        .catch((e) => { if (!controller.signal.aborted && current === revision.current) setStatus((e as Error).message); })
        .finally(() => { if (!controller.signal.aborted && current === revision.current) setQuoting(false); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairFrom, pairTo, tab, amount, inactive, site.tenantSlug, refreshQuote]);

  useEffect(() => {
    if (!quote) return;
    const delay = Math.max(0, new Date(quote.expiresAt).getTime() - Date.now());
    const timer = setTimeout(() => { setStep('exchange'); setStatus('Your quote expired. Requesting a fresh one…'); setRefreshQuote((n) => n + 1); }, delay);
    return () => clearTimeout(timer);
  }, [quote]);

  const select = (o: Option) => {
    if (picker === 'from') { setFromKey(o.key); setToKey(null); }
    else { setFromKey(pair?.from.key ?? null); setToKey(o.key); }
    reset(); setPicker(null);
  };
  const reverse = () => {
    if (!pair) return;
    const back = pairs.find((p) => p.from.key === pair.to.key && p.to.key === pair.from.key) ?? pairs.find((p) => p.from.endpoint === pair.to.endpoint && p.to.endpoint === pair.from.endpoint) ?? pairs.find((p) => p.from.key === pair.to.key);
    if (!back) return;
    setFromKey(back.from.key); setToKey(back.to.key); reset();
  };
  const canReverse = !!pair && pairs.some((p) => p.from.key === pair.to.key);

  const next = () => {
    setTouched(true);
    if (!amount || Number(amount) <= 0) return;
    if (!validQuote(quote)) { setStatus('A valid, unexpired quote is required to continue.'); setRefreshQuote((n) => n + 1); return; }
    setStatus(null); setStep('details');
  };
  const bodyFor = (q: ExchangeQuote) => ({ quoteToken: q.token, idempotencyKey: idempotency.current, workflowVersion: 2 as const, customerName: form.name.trim(), customerEmail: form.email.trim(), contactConsent: true as const, customerDetails: toCustomerDetails(form, kind) });
  const expired = () => { setStep('exchange'); setStatus('Your quote expired. Requesting a fresh one. Your details are kept.'); setRefreshQuote((n) => n + 1); };
  const toReview = async () => {
    const e = validateDetails(form, kind,requirements); setErrors(e);
    if (Object.keys(e).length) return;
    if (!validQuote(quote)) { expired(); return; }
    setReviewing(true); setStatus(null);
    try {
      // Read-only validation. This never creates an order.
      setReview(await reviewSandboxOrder(site.tenantSlug, bodyFor(quote)));
      setStep('review');
    } catch (err) {
      if ((err as { status?: number }).status === 409) expired();
      else setStatus((err as Error).message);
    } finally { setReviewing(false); }
  };
  const create = async () => {
    if (inactive || !pair) return;
    if (!validQuote(quote)) { setStep('exchange'); setStatus('Your quote expired. Requesting a fresh one…'); setRefreshQuote((n) => n + 1); return; }
    const e = validateDetails(form, kind,requirements); setErrors(e);
    if (Object.keys(e).length) { setStep('details'); return; }
    const payload = bodyFor(quote);
    const fingerprint = JSON.stringify({ ...payload, idempotencyKey: '' });
    // An uncertain failure keeps the same key and body so a retry can never create a second order.
    if (!attempted.current || attempted.current.fingerprint !== fingerprint) attempted.current = { fingerprint, payload };
    setSubmitting(true); setStatus(null);
    try {
      const result = await createSandboxOrder(site.tenantSlug, attempted.current.payload);
      attempted.current = null;
      try { sessionStorage.setItem(`exchange-created:${result.order.id}`, '1'); } catch { /* Tracking still works without session storage. */ }
      window.location.assign(`${import.meta.env.BASE_URL}${site.tenantSlug}/orders/${result.order.id}#${result.trackingToken}`);
    } catch (err) { if ((err as { status?: number }).status === 409) { setSubmitting(false); attempted.current = null; expired(); return; } setStatus(`${(err as Error).message} You can safely press Create order again; the same request is reused.`); setSubmitting(false); }
  };

  const notice = loadingCfg ? 'Loading exchange configuration…'
    : errorCfg ? 'Exchange configuration could not be loaded.'
    : !config?.enabled ? 'Exchange is paused. This client has not enabled sandbox trading yet.'
    : !tabs.length ? 'No exchange actions are enabled yet.'
    : previewProof ? 'Read-only preview. Quotes and orders are disabled.'
    : !pairs.length ? `No ${LABEL[tab].toLowerCase()} route is enabled with a compatible payment method yet.`
    : null;
  const blockedCta = inactive || !pairs.length;

  return (
    <WidgetShell>
      <div aria-label="Exchange (sandbox)" className="s-exchange-functional" data-testid={`step-current-${step}`}>
        <div className="s-action-header flex items-center justify-between gap-3">
          <div role="tablist" aria-label="Exchange action" className="s-tabs overflow-x-auto">
            {!tabs.length && <span className="s-tab" aria-disabled="true" data-testid="state-actions-unconfigured">Actions not configured</span>}
            {tabs.map((t) => <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} className="s-tab" onClick={() => changeTab(t)} data-testid={`tab-${t}`}>{LABEL[t]}</button>)}
          </div>
          <span className="s-badge shrink-0" data-testid="badge-sandbox">{site.websiteSettings.sandboxLabel ?? 'Sandbox'}</span>
        </div>
        {(
          <ol className="mt-4 flex items-center gap-2 text-xs" aria-label="Progress" data-testid="stepper">
            {STEPS.map((s, i) => { const idx = STEPS.findIndex((x) => x.id === step); return (
              <li key={s.id} className="flex flex-1 items-center gap-2" aria-current={s.id === step ? 'step' : undefined} data-testid={`stepper-${s.id}`}>
                <span className="s-coin" style={{ width: 24, height: 24, fontSize: 11, background: i <= idx ? 'var(--s-accent)' : 'var(--s-secondary)', color: 'var(--s-bg)' }}>{i + 1}</span>
                <span className={i === idx ? 'font-semibold' : 's-muted'}>{s.label}</span>
                {i < STEPS.length - 1 && <span className="h-px flex-1" style={{ background: 'var(--s-line)' }} />}
              </li>); })}
          </ol>
        )}

        {step === 'exchange' && (
          <div className="mt-4 sm:mt-5">
            <Side id="top" label={pair?.from.kind === 'fiat' ? 'You pay' : tab === 'convert' ? 'You convert' : 'You send'} option={pair?.from ?? null} value={amount} onValue={(v) => { setAmount(v); setStatus(null); }} onPick={() => setPicker('from')} error={amountError} disabled={!fromOptions.length} />
            <button type="button" className="s-swapbtn" onClick={reverse} aria-label="Reverse direction" disabled={!canReverse} data-testid="button-switch-direction"><ArrowDownUp size={17} /></button>
            <Side id="bottom" label="You receive" option={pair?.to ?? null} value={quote?.outputAmount ?? ''} readOnly onPick={() => setPicker('to')} disabled={!toOptions.length} />
            <p className="s-muted mt-2 text-xs" aria-live="polite" data-testid="text-receive-note">{quoting ? 'Calculating quote…' : quote ? `Quote valid until ${new Date(quote.expiresAt).toLocaleTimeString()}` : 'Receive amount appears once a quote is available.'}</p>
            <QuotePanel quote={quote} route={pair?.route} quoting={quoting} canRefresh={!inactive && !!amount && !quote && !quoting} onRefresh={() => setRefreshQuote((n) => n + 1)} />
            <button type="button" className="s-btn s-btn-primary s-cta-xl mt-5 w-full" onClick={next} disabled={blockedCta || quoting || !quote} data-testid="button-exchange-cta">{tab === 'swap' ? 'Continue' : 'Continue to customer details'}</button>
          </div>
        )}
        {step === 'details' && pair && <>
          <DetailsStep form={form} errors={errors} kind={kind} method={method} memoRequired={requirements.memo} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />
          <div className="mt-5 flex gap-3"><button type="button" className="s-btn flex-1" onClick={() => setStep('exchange')} data-testid="button-back-exchange">Back</button><button type="button" className="s-btn s-btn-primary flex-1" onClick={toReview} disabled={reviewing} data-testid="button-next-review">{reviewing ? 'Checking…' : 'Next'}</button></div>
        </>}
        {step === 'review' && pair && validQuote(quote) && <>
          <ReviewStep review={review} quote={quote} pair={pair} form={form} kind={kind} />
          <div className="mt-5 flex gap-3"><button type="button" className="s-btn flex-1" onClick={() => setStep('details')} disabled={submitting} data-testid="button-back-details">Back</button><button type="button" className="s-btn s-btn-primary flex-1" onClick={create} disabled={submitting} data-testid="button-create-order">{submitting ? 'Creating order…' : 'Create order'}</button></div>
        </>}

        {!inactive && config?.publicNote && <p className="s-muted mt-3 text-xs">{config.publicNote}</p>}
        <div role="status" aria-live="polite" className="mt-3 min-h-[1.25rem]">
          {!status && notice && <p className="s-muted flex items-start gap-2 text-xs leading-relaxed" data-testid="status-exchange-inline"><Info size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--s-accent-ink)' }} aria-hidden="true" />{notice}{errorCfg && <button type="button" className="s-link ml-2" onClick={() => exchangeQ.refetch()}>Try again</button>}</p>}
          {status && <p className="flex items-start gap-2 text-xs leading-relaxed" data-testid="status-sandbox"><ShieldCheck size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--s-accent-ink)' }} aria-hidden="true" />{status}</p>}
        </div>
        {picker && <OptionPicker options={picker === 'from' ? fromOptions : toOptions} selected={(picker === 'from' ? pair?.from : pair?.to)?.key ?? null} title={picker === 'from' ? 'Select what you send' : 'Select what you receive'} onSelect={select} onClose={() => setPicker(null)} />}
      </div>
    </WidgetShell>
  );
}
