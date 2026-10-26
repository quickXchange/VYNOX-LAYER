import { createContext, useContext, useState } from 'react';
import { ArrowDownUp, ChevronDown, ShieldCheck } from 'lucide-react';
import type { PublicSite } from '@workspace/api-client-react';
import type { Caps, ExchangeTab } from '../../lib/capabilities';
import { AMOUNT } from '../../lib/exchange-model';
import { AssetPicker, Coin, NetBadge, assetKey } from '../asset-picker';
import { WidgetShell } from './widget-shell';
import { SimOrderFlow } from './sim-order-flow';
import { SAMPLE_DETAILS, amountError as simAmountError, sampleAmount, simQuote, type SimDetails, type SimStage } from '../../lib/sim-order';

const LABEL: Record<ExchangeTab, string> = { swap: 'Swap', convert: 'Convert' };
const NOQ = 'No pricing source is connected in this sandbox.';

/** Marketing-shell showcase of the exchange. Display only: it never requests quotes or creates orders. */
export interface WidgetSimulation {
  price: (assetId: string) => number; paymentMethods: { id: string; label: string; note: string }[];
  /** Design-preview only: records an amounts-only demo order in memory, returns its sample reference. */
  onComplete?: (o: SimCompletion) => string | null; adminHref?: (ref: string) => string;
}
export interface SimCompletion { clientId: string; action: 'Swap' | 'Convert'; payAmount: number; paySymbol: string; receiveAmount: number; receiveSymbol: string; rate: number; fee: number; method: string | null }
const fmt = (n: number) => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(6));

export const SimulationContext = createContext<WidgetSimulation | undefined>(undefined);

/** `simulation` is used only by the isolated design preview: synthetic local math, never a quote. */
export function PresentationWidget({ site, caps, allowedActions, simulation: simProp }: { site: PublicSite; caps: Caps; allowedActions?: ExchangeTab[]; simulation?: WidgetSimulation }) {
  const ctxSim = useContext(SimulationContext);
  const simulation = simProp ?? ctxSim;
  const assets = site.assets;
  const tabs = allowedActions ? caps.tabs.filter((t) => allowedActions.includes(t)) : caps.tabs;
  const [tab, setTab] = useState<ExchangeTab>(tabs[0] ?? 'swap');
  const [fromKey, setFromKey] = useState<string | null>(assets[0] ? assetKey(assets[0]) : null);
  const [toKey, setToKey] = useState<string | null>(() => { const o = assets.find((a) => a.assetId !== assets[0]?.assetId); return o ? assetKey(o) : null; });
  const [amount, setAmount] = useState(() => (simulation ? sampleAmount((tabs[0] ?? 'swap') !== 'convert', assets[0] ? simulation.price(assets[0].assetId) : NaN) : ''));
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [fiatTop, setFiatTop] = useState(true);
  const [runs, setRuns] = useState(0);
  const [stage, setStage] = useState<SimStage>('amount');
  const [simDetails, setSimDetails] = useState<SimDetails>(SAMPLE_DETAILS);
  const [method, setMethod] = useState(simulation?.paymentMethods[0]?.id ?? '');
  const from = assets.find((a) => assetKey(a) === fromKey) ?? null;
  const to = assets.find((a) => assetKey(a) === toKey) ?? null;
  const convert = tab === 'convert';
  /** Simulation only: keep the default journey near 250 fiat when the input currency changes. */
  const resample = (inputFiat: boolean, assetId = from?.assetId) => {
    if (!simulation) return;
    setAmount(sampleAmount(inputFiat, assetId ? simulation.price(assetId) : NaN));
  };
  const distinct = new Set(assets.map((a) => a.assetId)).size;
  const amountError = touched && (amount === '' || Number(amount) <= 0) ? 'Enter an amount greater than zero.' : null;

  if (caps.exchange === 'empty') return (
    <WidgetShell>
      <div className="py-6 text-center" data-testid="state-exchange-empty">
        <span className="s-badge">Exchange enabled</span>
        <h3 className="mt-4 text-xl font-semibold">No exchange actions are enabled yet</h3>
        <p className="s-muted mx-auto mt-2 max-w-sm text-sm leading-relaxed">{site.brandName} has the exchange service turned on, but neither Swap nor Convert has been enabled. They will appear here once configured.</p>
      </div>
    </WidgetShell>);

  const fiatPill = (id: string) => <span className="s-pick" style={{ cursor: 'default' }} data-testid={`pill-fiat-${id}`}><span className="s-coin" style={{ width: 52, height: 52, background: 'var(--s-secondary)', color: 'var(--s-bg)' }}>Fi</span>Fiat</span>;
  const cryptoBtn = (id: string, label: string, a: typeof from, which: 'from' | 'to') => (
    <button type="button" className="s-pick" onClick={() => setPicker(which)} disabled={!assets.length} aria-haspopup="dialog" aria-label={`${label}: choose asset`} data-testid={`button-asset-${id}`}>
      {a ? <Coin asset={a} size={52} /> : <span className="s-coin" style={{ width: 52, height: 52, background: 'var(--s-secondary)' }}>?</span>}
      <span className="truncate">{a ? a.symbol : 'Select'}</span><ChevronDown size={15} aria-hidden="true" />
    </button>);
  const info = (a: typeof from, fiat: boolean) => <div className="mt-2 flex min-h-[22px] items-center gap-2 text-xs">{fiat ? <span className="s-muted">Sandbox fiat</span> : a ? <><NetBadge a={a} /><span className="s-muted truncate">{a.name}</span></> : <span className="s-muted">No asset selected</span>}</div>;
  const topFiat = !convert && fiatTop, botFiat = !convert && !fiatTop;
  const topAsset = convert ? from : topFiat ? null : from;
  const botAsset = convert ? to : botFiat ? null : from;

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (!(convert ? from && to : from)) { setStatus('Choose an asset first.'); return; }
    if (amount === '' || Number(amount) <= 0) { setStatus(null); return; }
    if (simulation) {
      if (!convert && !simulation.paymentMethods.some((m) => m.id === method)) {
        setStatus('Choose an enabled sample payment method. If none are available, enable one in the simulation admin.');
        return;
      }
      const err = simAmountError(amount, simQ?.fiatValue ?? null);
      if (err || !simQ) { setStatus(`${err ?? 'Choose assets first.'} (simulation)`); return; }
      setStatus(null); setStage('details'); return;
    }
    setStatus('Sandbox preview only. No order was created and nothing was sent.');
  };
  const pick = (a: NonNullable<typeof from>) => {
    const k = assetKey(a);
    if (picker === 'from') { setFromKey(k); resample(topFiat, a.assetId); if (convert && to?.assetId === a.assetId) setToKey(null); }
    else { setToKey(k); if (convert && from?.assetId === a.assetId) setFromKey(null); }
    setPicker(null);
  };
  const blocked = convert ? (picker === 'from' ? to?.assetId : from?.assetId) : null;
  const amt = Number(amount);
  const simRate = simulation && from && (convert ? to : true) ? (convert ? simulation.price(from.assetId) / simulation.price(to!.assetId) : simulation.price(from.assetId)) : null;
  const simVals: Record<string, string> = simRate && from ? {
    rate: convert ? `1 ${from.symbol} = ${fmt(simRate)} ${to!.symbol}` : `1 ${from.symbol} = ${fmt(simRate)} fiat`,
    min: convert ? `${fmt(25 / simulation!.price(from.assetId))} ${from.symbol}` : '25 fiat', max: convert ? `${fmt(25000 / simulation!.price(from.assetId))} ${from.symbol}` : '25,000 fiat', fee: '0.35%',
  } : {};
  const simQ = simulation && from && (!convert || to) ? simQuote({ amount: amt, fromPrice: simulation.price(from.assetId), toPrice: to ? simulation.price(to.assetId) : undefined, convert, fiatIn: topFiat }) : null;
  const row = (k: string, l: string) => <div className="flex items-center justify-between gap-3 py-1.5" key={k}><dt>{l}</dt><dd className="s-muted" title={simulation ? 'Synthetic sample value' : NOQ} data-testid={`text-${k}`}>{simVals[k] ? `${simVals[k]} (sample)` : 'Unavailable'}</dd></div>;

  if (simulation && stage !== 'amount' && simQ && from) {
    const crypto = from.symbol;
    const summary = { action: convert ? 'Convert' as const : 'Swap' as const, payLabel: topFiat ? 'You pay' : convert ? 'You convert' : 'You send', receiveLabel: 'You receive (sample)', paySymbol: topFiat ? 'fiat' : crypto, receiveSymbol: convert ? to!.symbol : topFiat ? crypto : 'fiat', amount: amt, quote: simQ, method: convert ? null : simulation.paymentMethods.find((m) => m.id === method)?.label ?? null };
    const sim = simulation;
    const onComplete = sim.onComplete ? () => sim.onComplete!({ clientId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, action: summary.action, payAmount: amt, paySymbol: summary.paySymbol, receiveAmount: simQ.net, receiveSymbol: summary.receiveSymbol, rate: simQ.rate, fee: simQ.fee, method: summary.method }) : undefined;
    return (
      <WidgetShell>
        <SimOrderFlow key={runs} details={simDetails} setDetails={setSimDetails} stage={stage} setStage={setStage} run={runs + 1}
          summary={summary} onComplete={onComplete} adminHref={sim.adminHref}
          onEdit={() => setStage('amount')}
          onRestart={() => { setSimDetails(SAMPLE_DETAILS); setRuns((n) => n + 1); setStage('amount'); setTouched(false); setStatus(null); }} />
      </WidgetShell>);
  }

  return (
    <WidgetShell>
      <form onSubmit={submit} noValidate aria-label="Exchange (sandbox)">
        <div className="s-action-header flex items-center justify-between gap-3">
          <div role="tablist" aria-label="Exchange action" className="s-tabs overflow-x-auto">
            {tabs.map((t) => <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} className="s-tab" onClick={() => { setTab(t); setTouched(false); setStatus(null); resample(t !== 'convert' && fiatTop); }} data-testid={`tab-${t}`}>{LABEL[t]}</button>)}
          </div>
          <span className="s-badge shrink-0" data-testid="badge-sandbox">{site.websiteSettings.sandboxLabel ?? 'Sandbox'}</span>
        </div>
        <div className="mt-4 sm:mt-5">
          <div className="s-side" style={amountError ? { borderColor: '#d9485f' } : undefined}>
            <label htmlFor="amt-top" className="s-lab">{topFiat ? 'You pay' : convert ? 'You convert' : 'You send'}</label>
            <div className="mt-1.5 flex items-center gap-3">
              <input id="amt-top" className="s-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => { const v = e.target.value.replace(',', '.'); if (AMOUNT.test(v)) { setAmount(v); setStatus(null); } }} data-testid="input-amount-top" />
              {topFiat ? fiatPill('top') : cryptoBtn('top', 'You send', topAsset, 'from')}
            </div>
            {info(topAsset, topFiat)}
          </div>
          {amountError && <p role="alert" className="mt-1.5 text-xs font-medium" style={{ color: '#e5556b' }}>{amountError}</p>}
          <button type="button" className="s-swapbtn" onClick={() => { if (convert) { const f = fromKey; setFromKey(toKey); setToKey(f); const na = assets.find((a) => assetKey(a) === toKey); if (na) resample(false, na.assetId); } else { resample(!fiatTop); setFiatTop((v) => !v); } }} aria-label="Switch direction" data-testid="button-switch-direction"><ArrowDownUp size={17} /></button>
          <div className="s-side s-side-out">
            <label htmlFor="amt-bottom" className="s-lab">You receive</label>
            <div className="mt-1.5 flex items-center gap-3">
              <input id="amt-bottom" className="s-amount" readOnly placeholder="0.00" value={simQ ? fmt(simQ.net) : ''} data-testid="input-amount-bottom" />
              {botFiat ? fiatPill('bottom') : cryptoBtn('bottom', 'You receive', botAsset, convert ? 'to' : 'from')}
            </div>
            {info(botAsset, botFiat)}
          </div>
          <p className="s-muted mt-2 text-xs" data-testid="text-receive-note">{simulation ? 'Synthetic sample amount for design preview. Not a quote.' : 'Receive amount appears once a quote is available.'}</p>
          {simulation && !convert && simulation.paymentMethods.length > 0 && (
            <fieldset className="mt-4" data-testid="group-sample-payment-methods"><legend className="s-lab">{topFiat ? 'Pay with (sample)' : 'Receive to (sample)'}</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">{simulation.paymentMethods.map((m) => (
                <button key={m.id} type="button" aria-pressed={method === m.id} onClick={() => setMethod(m.id)} className="s-tile rounded-[var(--s-r1)] border px-3 py-2 text-left text-sm" style={{ borderColor: method === m.id ? 'var(--s-accent)' : 'var(--s-line)' }} data-testid={`button-sample-method-${m.id}`}>
                  <span className="block font-medium">{m.label}</span><span className="s-muted block text-[11px]">{m.note}</span></button>))}</div>
            </fieldset>)}
        </div>
        <dl className="s-ratebox mt-4 divide-y rounded-[var(--s-r2)] border px-4 py-2.5" style={{ borderColor: 'var(--s-line)' }} data-testid="panel-rate">
          {row('rate', 'Rate')}{row('min', 'Minimum')}{row('max', 'Maximum')}{row('fee', 'Source fees')}
          <p className="s-muted pt-2 text-xs">{simulation ? 'Synthetic sample figures for design preview only. Not quotes, not market data.' : `${NOQ} Nothing here is an estimate.`}</p>
        </dl>
        <button type="submit" className="s-btn s-btn-primary s-cta-xl mt-5 w-full" disabled={!assets.length || (convert && distinct < 2)} data-testid="button-exchange-cta">{simulation ? `${LABEL[tab]} (simulation)` : 'Preview order (sandbox)'}</button>
        <div role="status" aria-live="polite" className="mt-3 min-h-[1.25rem]">
          {status && <p className="flex items-start gap-2 text-xs leading-relaxed" data-testid="status-sandbox"><ShieldCheck size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--s-accent-ink)' }} aria-hidden="true" />{status}</p>}
        </div>
        {picker && <AssetPicker assets={assets} selected={(picker === 'from' ? from : to) ? assetKey((picker === 'from' ? from : to)!) : null} blockedAssetId={blocked} title={picker === 'from' ? 'Select asset to send' : 'Select asset to receive'} onSelect={pick} onClose={() => setPicker(null)} />}
      </form>
    </WidgetShell>
  );
}
