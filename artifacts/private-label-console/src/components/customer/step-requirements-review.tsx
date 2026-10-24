import { Textarea } from '@/components/ui/textarea';
import { Uploader, AttachmentChip } from '@/components/customer/attachments';
import { cash, periodPrice, sumNum, unknownCount, type Catalog } from '@/lib/wl';
import type { Cfg, StepProps } from './configure-state';
import { Entitlements } from './plan-bits';

export function RequirementsStep({ cfg, set, onBusy }: StepProps) {
  return (
    <div className="space-y-5">
      <label className="block space-y-1 text-sm"><span>Details</span><Textarea data-testid="input-details" className="min-h-40" value={cfg.details} onChange={(e) => set({ details: e.target.value })} />
        <span className={`block text-right text-xs ${cfg.details.length > 10000 ? 'text-destructive' : 'text-muted-foreground'}`}>{cfg.details.length} / 10000</span></label>
      <div className="space-y-2"><p className="text-sm">Attachments</p><Uploader category="requirement" label="Upload files" items={cfg.reqFiles} onAdd={(a) => set((c) => ({ reqFiles: [...c.reqFiles, a] }))} onRemove={(id) => set((c) => ({ reqFiles: c.reqFiles.filter((x) => x.id !== id) }))} onBusy={onBusy} /></div>
    </div>
  );
}

const Row = ({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) => <div className={`flex justify-between gap-4 py-1.5 text-sm ${strong ? 'font-medium' : ''}`}><dt className="min-w-0 flex-1 break-words text-muted-foreground">{k}</dt><dd className="min-w-0 flex-[1.4] whitespace-pre-wrap text-right [overflow-wrap:anywhere]">{v}</dd></div>;
const Sec = ({ t, children }: { t: string; children: React.ReactNode }) => <section className="rounded-md border bg-card p-4"><h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-copper">{t}</h3>{children}</section>;

export function ReviewStep({ cfg, cat }: { cfg: Cfg; cat?: Catalog }) {
  const plan = cat?.plans.find((p) => p.id === cfg.planId); const addons = (cat?.addons ?? []).filter((a) => cfg.addonIds.includes(a.id));
  const cur = (plan as { currency?: string } | undefined)?.currency; const per = cfg.period === 'yearly' ? 'year' : 'month';
  const pp = periodPrice(plan, cfg.period); const rec = sumNum([pp, ...addons.map((a) => periodPrice(a, cfg.period))]);
  const setup = sumNum([plan?.setupFee, ...addons.map((a) => a.setupFee)]);
  const custom = cfg.designType === 'custom';
  const recU = [pp, ...addons.map((a) => periodPrice(a, cfg.period))]; const setU = [plan?.setupFee, ...addons.map((a) => a.setupFee)];
  const unknown = [...(pp == null ? [plan?.name ?? 'Plan'] : []), ...addons.filter((a) => periodPrice(a, cfg.period) == null).map((a) => `${a.name} recurring`), ...(plan && plan.setupFee == null ? [`${plan.name} setup`] : []), ...addons.filter((a) => a.setupFee == null).map((a) => `${a.name} setup`)];
  return (
    <div className="space-y-4">
      <Sec t="Project"><dl><Row k="Brand" v={cfg.brandName} /><Row k="Preferred domain" v={cfg.domain} /><Row k="Features" v={<span className="capitalize">{cfg.acts.join(', ')}</span>} /></dl></Sec>
      <Sec t="Design"><dl><Row k="Type" v={custom ? 'Custom design (paid review)' : 'Standard (Exchange master)'} />
        <Row k="Colors" v={<span className="flex flex-wrap justify-end gap-2">{[cfg.primary, cfg.accent].map((color, i) => <span key={i} className="inline-flex items-center gap-1.5"><i className="h-4 w-4 shrink-0 rounded border" style={{ background: color }} />{color}</span>)}</span>} /><Row k="Theme" v={<span className="capitalize">{cfg.theme}</span>} />
        {custom && <><Row k="Style" v={cfg.styleName} /><Row k="Description" v={cfg.description || '-'} /><Row k="Reference site" v={cfg.refUrl || '-'} /><Row k="Notes" v={cfg.notes || '-'} /></>}</dl>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{[cfg.logo, cfg.favicon, ...(custom ? cfg.refs : [])].filter((a) => a != null).map((a) => <AttachmentChip key={a.id} a={a} />)}</div></Sec>
      <Sec t="Plan and add-ons">
        {plan ? <><Row k={`${plan.name} (${cfg.period})`} v={`${cash(pp, cur)} / ${per}`} /><Entitlements items={plan.entitlements} defs={cat?.definitions ?? []} />
          {addons.map((a) => <Row key={a.id} k={`Add-on: ${a.name}`} v={`${cash(periodPrice(a, cfg.period), a.currency)} / ${per}`} />)}</> : <p className="text-sm">No plan selected</p>}</Sec>
      <Sec t="Requirements"><p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{cfg.details || 'No details provided'}</p>{cfg.reqFiles.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-2">{cfg.reqFiles.map((a) => <AttachmentChip key={a.id} a={a} />)}</div>}</Sec>
      <Sec t="Estimated pricing"><dl className="divide-y">
        <Row k={`Base plan recurring / ${per}`} v={cash(pp, cur)} /><Row k={`Add-ons recurring / ${per}`} v={unknownCount(addons.map((a) => periodPrice(a, cfg.period))) ? 'Partly requires review' : cash(sumNum(addons.map((a) => periodPrice(a, cfg.period))), cur)} />
        <Row k="Setup fees (plan and add-ons)" v={cash(setup, cur)} /><Row k="Customization fee" v={custom ? 'Requires review' : 'No customization requested'} />
        <Row strong k={`Known recurring subtotal / ${per}`} v={cash(rec, cur)} /><Row strong k="Known one-time setup subtotal" v={cash(setup, cur)} /></dl>
        {(unknownCount(recU) + unknownCount(setU)) > 0 && <div className="mt-3 rounded border border-dashed p-3 text-sm" data-testid="unknown-fees"><p className="font-medium">Fees requiring review (not in subtotals)</p><ul className="list-disc pl-5 text-muted-foreground">{unknown.map((u) => <li key={u}>{u}</li>)}</ul></div>}
        <p className="mt-3 text-xs text-muted-foreground">This is a configured estimate. Final prices are set by a Super Admin review. Nothing is charged and nothing is implemented automatically.</p></Sec>
    </div>
  );
}
