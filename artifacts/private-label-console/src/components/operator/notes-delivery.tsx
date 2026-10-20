import { useState } from 'react';
import { Link } from 'wouter';
import { useAddWhiteLabelNote, useProvisionWhiteLabelRequest, useListTenants } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { errMsg, type WlOrder } from '@/lib/wl';
import { ErrorState, ListSkeleton } from '@/components/app/bits';
import { ReviewDialog } from '@/components/super-admin/kit';
import { useToast } from '@/hooks/use-toast';

export function NoteForm({ id, onDone, fixed }: { id: string; onDone: () => void; fixed?: 'internal' | 'customer' }) {
  const add = useAddWhiteLabelNote(); const [msg, setMsg] = useState(''); const [vis, setVis] = useState<'internal' | 'customer'>(fixed ?? 'internal'); const [err, setErr] = useState<string | null>(null); const [rev, setRev] = useState(false); const { toast } = useToast();
  const go = () => { setErr(null); add.mutate({ requestId: id, data: { message: msg.trim(), visibility: vis } }, { onSuccess: () => { setMsg(''); setRev(false); toast({ title: 'Note added' }); onDone(); }, onError: (e) => { setErr(errMsg(e)); toast({ title: 'Note failed', description: errMsg(e), variant: 'destructive' }); } }); };
  return (
    <div className="space-y-2">
      <Textarea data-testid="input-note" aria-label="New note" value={msg} disabled={add.isPending} onChange={(e) => setMsg(e.target.value)} maxLength={3000} placeholder="Append a note. Existing notes are never overwritten." />
      <div className="flex flex-wrap items-center gap-2">
        {fixed ? <span className="text-xs text-muted-foreground">{fixed === 'internal' ? 'Internal only' : 'Visible to customer'}</span> : <select aria-label="Visibility" className="h-9 rounded-md border bg-background px-2 text-sm" value={vis} onChange={(e) => setVis(e.target.value as typeof vis)}><option value="internal">Internal only</option><option value="customer">Visible to customer</option></select>}
        <Button type="button" size="sm" data-testid="button-add-note" disabled={!msg.trim() || add.isPending} onClick={() => { setErr(null); setRev(true); }}>{add.isPending ? 'Adding' : 'Add note'}</Button>
      </div>
      {err && !rev && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <ReviewDialog open={rev} onClose={() => setRev(false)} title="add note" pending={add.isPending} error={err} onApply={go}
        rows={[['Visibility', vis === 'customer' ? 'Visible to the customer' : 'Internal only'], ['Note', msg.trim()]]} />
    </div>
  );
}

export function Delivery({ o, onDone }: { o: WlOrder; onDone: () => void }) {
  const tenants = useListTenants(); const prov = useProvisionWhiteLabelRequest(); const [tid, setTid] = useState(''); const [err, setErr] = useState<string | null>(null); const [rev, setRev] = useState(false); const { toast } = useToast();
  const ready = (tenants.data ?? []).filter((t) => t.status === 'active' && t.exchangeProvisioned === true);
  if (o.status === 'delivered' && o.tenantId) return <Link href={`/clients/${o.tenantId}`} className="text-sm text-copper underline">Delivered project details</Link>;
  if (!['approved', 'in_setup', 'customization', 'ready'].includes(o.status)) return <p className="text-sm text-muted-foreground">{['rejected', 'cancelled'].includes(o.status) ? 'This order is closed. Delivery is not available.' : 'Delivery is available after the order is approved.'}</p>;
  if (o.tenantId) return <div className="space-y-2 text-sm">
    <Button data-testid="button-deliver-linked" size="sm" disabled={o.status !== 'ready' || prov.isPending} title={o.status === 'ready' ? undefined : 'Mark the order Ready first'} onClick={() => { setErr(null); setRev(true); }}>{prov.isPending ? 'Delivering' : 'Deliver to customer'}</Button>
    {err && !rev && <p role="alert" className="text-destructive">{err}</p>}
    <ReviewDialog open={rev} onClose={() => setRev(false)} title="deliver order" pending={prov.isPending} error={err} applyLabel="Deliver to customer"
      onApply={() => { setErr(null); prov.mutate({ requestId: o.id, data: { tenantId: o.tenantId! } }, { onSuccess: () => { setRev(false); toast({ title: 'Delivered to customer' }); onDone(); }, onError: (e) => { setErr(errMsg(e)); toast({ title: 'Delivery failed', description: errMsg(e), variant: 'destructive' }); } }); }}
      rows={[['Order', o.projectName], ['Effect', 'Grants the customer access to the Ready project']]} />
    <p>Sandbox draft prepared and linked automatically. Customer access has not been granted.</p>
    <Link href={`/clients/${o.tenantId}`} className="text-copper underline" data-testid="link-prepared-exchange">Open project: Activate Sandbox, then Mark Ready</Link>
    <p className="text-muted-foreground">Three separate steps: Activate Sandbox (does not deliver), Mark Ready (does not deliver), then Deliver, which is only available once the order is Ready and sends access to the customer’s account.</p>
  </div>;
  if (tenants.isLoading) return <div role="status" aria-label="Loading prepared projects"><ListSkeleton rows={2} /></div>;
  if (tenants.isError) return <ErrorState what="prepared projects" onRetry={() => tenants.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="text-sm">Legacy order without a linked draft: prepare the tenant manually (plan and add-ons must match the reviewed order), then deliver it. Nothing is granted before delivery.</p>
      <div className="flex flex-wrap gap-3 text-sm text-copper"><Link href="/clients/new" className="underline" data-testid="link-prepare-new">Prepare new client</Link>{ready.map((t) => <Link key={t.id} href={`/clients/${t.id}`} className="underline">{t.brandName}</Link>)}</div>
      <div className="flex flex-col gap-3">
        <label className="block min-w-0 flex-1 text-sm">Prepared project<select data-testid="select-tenant" value={tid} onChange={(e) => setTid(e.target.value)} className="block h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm"><option value="">Select project</option>{ready.map((t) => <option key={t.id} value={t.id}>{t.brandName} ({t.slug})</option>)}</select></label>
        <Button data-testid="button-deliver" disabled={!tid || o.status !== 'ready' || prov.isPending} title={o.status === 'ready' ? undefined : 'Mark the order Ready first'} onClick={() => { setErr(null); setRev(true); }}>{prov.isPending ? 'Delivering' : 'Deliver to customer'}</Button>
      </div>
      {err && !rev && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{err}</p>}
      <ReviewDialog open={rev} onClose={() => setRev(false)} title="deliver legacy order" pending={prov.isPending} error={err} applyLabel="Deliver to customer"
        onApply={() => { setErr(null); prov.mutate({ requestId: o.id, data: { tenantId: tid } }, { onSuccess: () => { setRev(false); toast({ title: 'Delivered to customer' }); onDone(); }, onError: (e) => { setErr(errMsg(e)); toast({ title: 'Delivery failed', description: errMsg(e), variant: 'destructive' }); } }); }}
        rows={[['Order', o.projectName], ['Project', (tenants.data ?? []).find((t) => t.id === tid)?.brandName ?? tid], ['Effect', 'Grants the customer access to the prepared project']]} />
    </div>
  );
}
