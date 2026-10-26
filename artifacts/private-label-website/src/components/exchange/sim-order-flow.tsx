import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, LayoutDashboard, Check, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import { detailsErrors, simRef, type SimDetails, type SimQuote, type SimStage } from '../../lib/sim-order';

export interface SimSummary { action: 'Swap' | 'Convert'; payLabel: string; receiveLabel: string; paySymbol: string; receiveSymbol: string; amount: number; quote: SimQuote; method: string | null }
const fmt = (n: number) => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(6));
const STEPS: { k: SimStage; l: string }[] = [{ k: 'amount', l: 'Amount' }, { k: 'details', l: 'Details' }, { k: 'review', l: 'Review' }, { k: 'done', l: 'Complete' }];

/** Steps 2-4 of the design-preview simulator. Local state only; nothing leaves the browser. */
export function SimOrderFlow({ stage, setStage, summary, run, onEdit, onRestart, details: d, setDetails: setD, onComplete, adminHref }: { onComplete?: () => string | null; adminHref?: (ref: string) => string; details: SimDetails; setDetails: Dispatch<SetStateAction<SimDetails>>; stage: SimStage; setStage: (s: SimStage) => void; summary: SimSummary; run: number; onEdit: () => void; onRestart: () => void }) {
  const [tried, setTried] = useState(false);
  const recorded = useRef(false);
  const [demoRef, setDemoRef] = useState<string | null>(null);
  const confirm = () => {
    setTried(true); if (!d.agree) return;
    if (!recorded.current && onComplete) { recorded.current = true; setDemoRef(onComplete()); }
    setStage('done');
  };
  const errs = detailsErrors(d);
  const idx = STEPS.findIndex((s) => s.k === stage);
  const q = summary.quote;
  const rows: [string, string][] = [
    ['Action', `${summary.action} (simulation)`],
    [summary.payLabel, `${fmt(summary.amount)} ${summary.paySymbol}`],
    ['Sample rate', `1 ${summary.action === 'Convert' ? summary.paySymbol : summary.receiveSymbol === 'fiat' ? summary.paySymbol : summary.receiveSymbol} = ${fmt(q.rate)} ${summary.action === 'Convert' ? summary.receiveSymbol : 'fiat'}`],
    ['Sample fee (0.35%)', `${fmt(q.fee)} ${summary.receiveSymbol}`],
    [summary.receiveLabel, `${fmt(q.net)} ${summary.receiveSymbol}`],
    ...(summary.method ? [['Sample method', summary.method] as [string, string]] : []),
  ];
  const field = (k: 'fullName' | 'email' | 'destination', label: string, hint: string) => (
    <div>
      <label htmlFor={`sim-${k}`} className="s-lab">{label}</label>
      <input id={`sim-${k}`} className="s-side mt-1.5 w-full !py-3 text-sm" style={{ outline: 'none', borderColor: tried && errs[k] ? '#d9485f' : undefined }} value={d[k]} autoComplete="off" onChange={(e) => setD({ ...d, [k]: e.target.value })} data-testid={`input-sim-${k}`} />
      <p className="s-muted mt-1 text-[11px]" style={tried && errs[k] ? { color: '#e5556b' } : undefined}>{tried && errs[k] ? errs[k] : hint}</p>
    </div>);
  const summaryBox = (
    <dl className="s-ratebox divide-y rounded-[var(--s-r2)] border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--s-line)' }} data-testid="panel-sim-summary">
      {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-3 py-1.5"><dt>{k}</dt><dd className="s-muted text-right">{v}</dd></div>)}
    </dl>);

  return (
    <div data-testid={`sim-stage-${stage}`}>
      <div className="s-action-header flex items-center justify-between gap-3">
        <ol className="flex flex-1 gap-1.5" aria-label="Simulation steps">
          {STEPS.map((s, i) => <li key={s.k} className="flex-1"><span className="block h-1 rounded-full" style={{ background: i <= idx ? 'var(--s-accent)' : 'var(--s-line)' }} /><span className={`mt-1.5 block text-[11px] ${i === idx ? 'font-semibold' : 's-muted'}`}>{i + 1}. {s.l}</span></li>)}
        </ol>
        <span className="s-badge shrink-0">Simulation</span>
      </div>

      {stage === 'details' && (
        <form className="mt-5 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setTried(true); if (Object.keys(errs).length === 0) setStage('review'); }} aria-label="Simulated order details">
          <p className="s-muted text-xs">Synthetic example fields are pre-filled. Do not enter real personal, wallet or payment information.</p>
          {field('fullName', 'Name (sample)', 'Example value only.')}
          {field('email', 'Email (sample)', 'No email is sent. Use an example address.')}
          {field('destination', summary.action === 'Swap' && summary.receiveSymbol === 'fiat' ? 'Payout reference (sample)' : 'Destination reference (sample)', 'Synthetic placeholder. Not a real wallet address.')}
          <div className="flex gap-2 pt-1">
            <button type="button" className="s-btn s-btn-ghost" onClick={onEdit} data-testid="button-sim-back"><ArrowLeft size={15} />Back</button>
            <button type="submit" className="s-btn s-btn-primary flex-1" data-testid="button-sim-continue">Continue to review</button>
          </div>
        </form>)}

      {stage === 'review' && (
        <div className="mt-5 space-y-4">
          {summaryBox}
          <dl className="s-ratebox divide-y rounded-[var(--s-r2)] border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--s-line)' }}>
            {([['Name', d.fullName], ['Email', d.email], ['Reference', d.destination]] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt>{k}</dt><dd className="s-muted truncate">{v}</dd></div>)}
          </dl>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={d.agree} onChange={(e) => setD({ ...d, agree: e.target.checked })} className="mt-0.5" data-testid="checkbox-sim-agree" />I understand this is a simulation. No quote, order, payment or transfer will be created.</label>
          {tried && !d.agree && <p role="alert" className="text-xs" style={{ color: '#e5556b' }}>Confirm the simulation notice to continue.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="s-btn s-btn-ghost" onClick={() => setStage('details')} data-testid="button-sim-edit-details"><Pencil size={14} />Edit details</button>
            <button type="button" className="s-btn s-btn-ghost" onClick={onEdit} data-testid="button-sim-edit-amount">Edit amount</button>
            <button type="button" className="s-btn s-btn-primary w-full" onClick={confirm} data-testid="button-sim-confirm">Confirm simulated order</button>
          </div>
        </div>)}

      {stage === 'done' && (
        <div className="mt-5 space-y-4" data-testid="panel-sim-complete">
          <div className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full" style={{ background: 'var(--s-accent)', color: 'var(--s-bg)' }}><Check size={22} /></span>
            <h3 className="mt-3 text-lg font-semibold">Simulated order complete</h3>
            <p className="s-muted mt-1 font-mono text-xs" data-testid="text-sim-ref">{demoRef ?? simRef(run)} (sample reference)</p>
          </div>
          {summaryBox}
          <p className="flex items-start gap-2 text-xs leading-relaxed"><ShieldCheck size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--s-accent-ink)' }} />{demoRef ? 'Synthetic simulation only. No real quote, payment or order exists and nothing was sent to a server. An in-memory demo record (amounts only, no name, email or reference) was added to the simulation admin for this tab; it is cleared on reload or reset.' : 'Synthetic simulation only. No quote or order was created, no payment instructions exist and nothing was sent or saved.'}</p>
          {demoRef && adminHref && <Link href={adminHref(demoRef)} className="s-btn s-btn-ghost w-full" data-testid="link-sim-open-admin"><LayoutDashboard size={15} />View order in admin (simulation)</Link>}
          <button type="button" className="s-btn s-btn-primary w-full" onClick={onRestart} data-testid="button-sim-restart"><RotateCcw size={15} />Start a new simulation</button>
        </div>)}
    </div>
  );
}
