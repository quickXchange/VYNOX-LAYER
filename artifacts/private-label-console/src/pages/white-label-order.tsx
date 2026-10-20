import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetWhiteLabelRequest, getGetWhiteLabelRequestQueryKey, getListWhiteLabelRequestsQueryKey } from '@workspace/api-client-react';
import { PageHeader, ErrorState, ListSkeleton, EmptyState } from '@/components/app/bits';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrderStatus, OrderSummary, Timeline } from '@/components/customer/order-view';
import { ReviewForm } from '@/components/operator/review-form';
import { NoteForm, Delivery } from '@/components/operator/notes-delivery';
import { OrderActions } from '@/components/super-admin/order-actions';
import { Panel } from '@/components/super-admin/kit';
import { ProvisioningProgress } from '@/components/operator/provisioning-progress';
import { OperatorPayment } from '@/components/commerce/payment-panel';
import { orderRef } from '@/lib/wl';

export default function WhiteLabelOrder() {
  const { orderId = '' } = useParams<{ orderId: string }>(); const qc = useQueryClient();
  const [tab, setTab] = useState('summary');
  const [reviewRevision, setReviewRevision] = useState(0);
  const key = getGetWhiteLabelRequestQueryKey(orderId);
  const q = useGetWhiteLabelRequest(orderId, { query: { queryKey: key, enabled: !!orderId, refetchInterval: 5000, refetchOnWindowFocus: true } });
  const d = q.data;
  const refresh = async () => { await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: getListWhiteLabelRequestsQueryKey() })]); };
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (!d) return <ErrorState what="this order" onRetry={() => q.refetch()} />;
  const o = d.order;
  const notes = (v: 'internal' | 'customer') => d.history.filter((e) => e.kind === 'note' && e.visibility === v);
  const status = d.history.filter((e) => e.kind === 'status');
  return (
    <>
      {q.isError && <div role="alert" className="mb-4 rounded-md border p-3 text-sm">Could not refresh this order. Showing the last loaded data. <Button type="button" variant="outline" size="sm" onClick={() => q.refetch()}>Retry refresh</Button></div>}
      <PageHeader eyebrow={`Order ${orderRef(o)}`} title={o.projectName}><OrderStatus status={o.status} /><Button asChild variant="outline" size="sm"><Link href="/white-label-requests">All orders</Link></Button></PageHeader>
      <p className="mb-4 text-sm text-muted-foreground [overflow-wrap:anywhere]">Customer: {o.companyName || o.brandName} <span className="font-mono text-xs">({o.customerUserId})</span></p>
      <div className="mb-6"><OrderActions o={o} onDone={refresh} onDeliver={() => setTab('delivery')} /></div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="mb-4 overflow-x-auto"><TabsList className="w-max">
          {[['summary', 'Summary'], ['review', 'Review & pricing'], ['payment', 'Payment'], ['delivery', 'Delivery'], ['internal', `Internal notes (${notes('internal').length})`], ['customer', `Customer notes (${notes('customer').length})`], ['timeline', 'Timeline']].map(([v, l]) => <TabsTrigger key={v} value={v} data-testid={`tab-order-${v}`}>{l}</TabsTrigger>)}
        </TabsList></div>
        <TabsContent value="summary"><OrderSummary o={o} /></TabsContent>
        <TabsContent value="review"><div className="max-w-3xl"><Panel title="Review, pricing and status"><ReviewForm key={`${o.id}-${reviewRevision}`} o={o} onReload={() => setReviewRevision(v => v + 1)} onDone={async () => { await refresh(); setReviewRevision(v => v + 1); }} /></Panel></div></TabsContent>
        <TabsContent value="payment"><div className="max-w-3xl"><OperatorPayment orderId={o.id} onDone={refresh} /></div></TabsContent>
        <TabsContent value="delivery"><div className="max-w-3xl"><Panel title="Delivery"><div className="space-y-4"><ProvisioningProgress requestId={o.id} closed={['rejected', 'cancelled'].includes(o.status)} onDone={refresh} /><Delivery o={o} onDone={refresh} /></div></Panel></div></TabsContent>
        <TabsContent value="internal"><div className="max-w-3xl"><Panel title="Internal notes" note="Never shown to the customer."><NoteForm key={`${o.id}-internal`} fixed="internal" id={o.id} onDone={refresh} />
          <div className="mt-5">{notes('internal').length ? <Timeline history={notes('internal')} customerUserId={o.customerUserId} /> : <EmptyState title="No internal notes" body="Notes added here stay with operators." />}</div></Panel></div></TabsContent>
        <TabsContent value="customer"><div className="max-w-3xl"><Panel title="Customer notes" note="Visible to the customer on their order."><NoteForm key={`${o.id}-customer`} fixed="customer" id={o.id} onDone={refresh} />
          <div className="mt-5">{notes('customer').length ? <Timeline history={notes('customer')} customerUserId={o.customerUserId} /> : <EmptyState title="No customer notes" body="Messages sent to the customer appear here." />}</div></Panel></div></TabsContent>
        <TabsContent value="timeline"><div className="max-w-3xl"><Panel title="Status timeline"><Timeline history={status} customerUserId={o.customerUserId} empty="No status changes recorded." /></Panel></div></TabsContent>
      </Tabs>
    </>
  );
}
