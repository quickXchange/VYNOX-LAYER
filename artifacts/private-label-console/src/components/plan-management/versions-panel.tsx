import { useState } from 'react';
import { ErrorState, ListSkeleton } from '@/components/app/bits';
import { Panel, Pill, ReviewDialog } from '@/components/super-admin/kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useInvalidateCatalog } from '@/lib/invalidate';
import { useListPublicationVersions, type PublicationVersion as Version } from '@workspace/api-client-react';
import { usePmMutations } from './api';

export function VersionsPanel() {
  const q = useListPublicationVersions(); const { rollback } = usePmMutations(); const { toast } = useToast(); const inv = useInvalidateCatalog();
  const [pick, setPick] = useState<Version | null>(null); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <Panel title="Publication history" note="Every publication is an immutable snapshot. Rolling back republishes an earlier snapshot as a new version; it never edits plan drafts or customer contracts.">
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState what="publication history" onRetry={() => q.refetch()} /> : !q.data?.versions.length
        ? <p className="text-sm text-muted-foreground" data-testid="empty-versions">No recorded publications yet. The next publish creates version one.</p>
        : <ol className="divide-y" data-testid="list-versions">{q.data.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid={`row-version-${v.id}`}>
            <span className="font-mono text-xs">{new Date(v.publishedAt).toLocaleString()}</span>
            <span className="font-mono text-xs text-muted-foreground">{v.revision.slice(0, 10)}</span>
            {v.revision === q.data.currentRevision && <Pill tone="ok">Live</Pill>}{v.rollbackOf && <Pill tone="warn">Rollback</Pill>}
            <span className="min-w-0 flex-1 truncate">{v.reason}</span><span className="text-xs text-muted-foreground">{v.planCount} plans, by {v.publishedBy}</span>
            <Button size="sm" variant="outline" disabled={v.revision === q.data.currentRevision} onClick={() => { setErr(null); setReason(''); setPick(v); }} data-testid={`button-rollback-${v.id}`}>Roll back to this</Button>
          </li>))}</ol>}
      <ReviewDialog open={!!pick} onClose={() => setPick(null)} title="roll back publication" destructive applyLabel="Republish snapshot" pending={rollback.isPending} error={err}
        onApply={() => { if (!pick) return; if (reason.trim().length < 3) { setErr('Give a reason (3+ characters).'); return; }
          rollback.mutate({ versionId: pick.id, data: { expectedPublishedRevision: q.data?.currentRevision ?? null, reason: reason.trim() } }, { onSuccess: () => { setPick(null); inv(); toast({ title: 'Publication rolled back' }); }, onError: (e) => setErr((e as Error).message) }); }}
        rows={pick ? [['Snapshot', `${new Date(pick.publishedAt).toLocaleString()} (${pick.revision.slice(0, 10)})`], ['Plans in snapshot', String(pick.planCount)], ['Customers', 'Existing contracts unchanged'], ['Reason', <Input key="r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why roll back" data-testid="input-rollback-reason" />]] : []} />
    </Panel>
  );
}
