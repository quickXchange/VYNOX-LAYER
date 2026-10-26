import { ErrorState, ListSkeleton } from '@/components/app/bits';
import { Panel } from '@/components/super-admin/kit';
import { useGetPlanHistory } from '@workspace/api-client-react';

const changed = (m: Record<string, unknown>) => {
  const b = m.before as Record<string, unknown> | null | undefined, a = m.after as Record<string, unknown> | null | undefined;
  if (!b || !a || typeof b !== 'object' || typeof a !== 'object') return [];
  return Object.keys(a).filter((k) => !['updatedAt', 'revision', 'createdAt'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
};
export function PlanHistory({ planId }: { planId: string }) {
  const q = useGetPlanHistory(planId);
  return (
    <Panel title="Change history">
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState what="change history" onRetry={() => q.refetch()} /> : !q.data?.length ? <p className="text-sm text-muted-foreground">No recorded changes.</p> : (
        <ol className="space-y-2" data-testid="list-plan-history">{q.data.map((h) => { const f = changed(h.metadata); return (
          <li key={h.id} className="border-l-2 border-copper/50 pl-3 text-sm" data-testid={`row-history-${h.id}`}>
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{new Date(h.createdAt).toLocaleString()} / {h.eventType} / {h.actorId}</p>
            <p>{h.description}</p>{f.length > 0 && <p className="text-xs text-muted-foreground">Fields: {f.join(', ')}</p>}
          </li>); })}</ol>)}
    </Panel>
  );
}
