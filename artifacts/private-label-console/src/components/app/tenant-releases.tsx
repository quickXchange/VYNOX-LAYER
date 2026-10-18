import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Panel, Pill } from '@/components/super-admin/kit';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useInvalidateTenant } from '@/lib/invalidate';

type Releases = {
  liveReleaseId: string | null; draftChecksum: string; liveChecksum: string | null;
  checklist: { key: string; label: string; ready: boolean; message: string }[];
  history: { id: string; version: number; checksum: string; createdBy: string; createdAt: string; diff: string[] }[];
};

const SAFE = 'The request could not be completed. Please try again.';
async function call<T>(method: 'GET' | 'POST', path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { method, credentials: 'include', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' && body.error.length <= 2000 ? body.error : SAFE);
  }
  return res.json() as Promise<T>;
}
const short = (s: string | null) => (s ? s.slice(0, 12) : 'none');
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString(); };

export function TenantReleases({ tenantId, readOnly }: { tenantId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const inv = useInvalidateTenant();
  const { toast } = useToast();
  const key = ['/tenants', tenantId, 'releases'];
  const q = useQuery({ queryKey: key, queryFn: () => call<Releases>('GET', `/tenants/${encodeURIComponent(tenantId)}/releases`), retry: false, staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true });
  const [confirm, setConfirm] = useState<{ id: string; version: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); inv(tenantId); };
  const fail = (title: string) => (e: unknown) => toast({ title, description: e instanceof Error ? e.message : SAFE, variant: 'destructive' });
  const release = useMutation({ mutationFn: () => call('POST', `/tenants/${encodeURIComponent(tenantId)}/releases`), onSuccess: () => { refresh(); toast({ title: 'Draft released' }); }, onError: fail('Release failed') });
  const rollback = useMutation({ mutationFn: (id: string) => call('POST', `/tenants/${encodeURIComponent(tenantId)}/releases/${encodeURIComponent(id)}/rollback`), onSuccess: () => { refresh(); setConfirm(null); toast({ title: 'Rolled back' }); }, onError: (e) => { setConfirm(null); fail('Rollback failed')(e); } });

  const preview = async () => {
    const opened = window.open('', '_blank');
    if (opened) opened.opener = null;
    setPreviewing(true);
    try {
      const r = await call<{ url: string; expiresAt: string }>('POST', `/tenants/${encodeURIComponent(tenantId)}/release-preview`);
      if (opened) opened.location.replace(r.url);
      else window.location.assign(r.url);
      toast({ title: 'Draft preview opened', description: `Link expires ${when(r.expiresAt)}.` });
    } catch (e) { opened?.close(); fail('Preview unavailable')(e); } finally { setPreviewing(false); }
  };

  const d = q.data;
  const blockers = d?.checklist.filter((c) => !c.ready) ?? [];
  const unchanged = !!d && d.liveChecksum === d.draftChecksum;
  const canRelease = !!d && !readOnly && blockers.length === 0 && !unchanged && !release.isPending;

  return (
    <div className="space-y-6">
      <Panel title="Release" note="Releasing publishes the draft to the shared-master site. Preview shows exactly what visitors will see.">
        {q.isLoading ? <div className="space-y-2" data-testid="skeleton-releases"><Skeleton className="h-12" /><Skeleton className="h-24" /></div>
          : q.isError || !d ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert" data-testid="error-releases">
              <p>Releases could not be loaded.</p><Button size="sm" variant="outline" className="mt-2" onClick={() => q.refetch()} data-testid="button-retry-releases">Retry</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2">
                <div className="bg-card p-3"><dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Draft</dt><dd className="mt-1 font-mono text-xs" data-testid="text-draft-checksum">{short(d.draftChecksum)}</dd></div>
                <div className="bg-card p-3"><dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Live</dt><dd className="mt-1 font-mono text-xs" data-testid="text-live-checksum">{d.liveReleaseId ? short(d.liveChecksum) : 'Nothing released yet'}</dd></div>
              </dl>
              <p className="text-sm" data-testid="text-release-state">{!d.liveReleaseId ? 'No release is live.' : unchanged ? <Pill tone="ok">Draft matches live</Pill> : <Pill tone="warn">Unreleased changes</Pill>}</p>
              <ul className="divide-y rounded-md border" data-testid="release-checklist">
                {d.checklist.length === 0 && <li className="p-3 text-sm text-muted-foreground">No checks required.</li>}
                {d.checklist.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 p-3" data-testid={`checklist-${c.key}`}>
                    <Pill tone={c.ready ? 'ok' : 'bad'}>{c.ready ? 'Ready' : 'Blocked'}</Pill>
                    <div className="min-w-0 text-sm"><p>{c.label}</p><p className="text-xs text-muted-foreground">{c.message}</p></div>
                  </li>))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <Button data-testid="button-release-tenant" disabled={!canRelease} onClick={() => release.mutate()}>{release.isPending ? 'Releasing' : 'Release'}</Button>
                <Button variant="outline" data-testid="button-preview-draft" disabled={previewing} onClick={preview}>{previewing ? 'Opening' : 'Preview draft'}</Button>
                {readOnly ? <span className="text-xs text-muted-foreground">Read only</span> : blockers.length > 0 ? <span className="text-xs text-muted-foreground">Resolve {blockers.length} blocker{blockers.length > 1 ? 's' : ''} to release.</span> : unchanged ? <span className="text-xs text-muted-foreground">Nothing new to release.</span> : null}
              </div>
            </div>)}
      </Panel>

      <div data-testid="panel-release-history">
        <Panel title="Release history">
          {q.isLoading ? <Skeleton className="h-20" /> : !d ? <p className="text-sm text-muted-foreground">History unavailable.</p> : d.history.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="empty-release-history">No releases yet. The first release will appear here.</p>
          ) : (
            <ol className="divide-y rounded-md border">
              {d.history.map((h) => {
                const live = h.id === d.liveReleaseId;
                return (
                  <li key={h.id} className="space-y-2 p-3" data-testid={`row-release-${h.id}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-display text-base">v{h.version}</span>{live && <Pill tone="ok">Live</Pill>}
                      <span className="text-muted-foreground">by {h.createdBy} · {when(h.createdAt)}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{short(h.checksum)}</span>
                    </div>
                    {h.diff.length > 0 ? <ul className="flex flex-wrap gap-1.5">{h.diff.map((p) => <li key={p} className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[11px]">{p}</li>)}</ul> : <p className="text-xs text-muted-foreground">No field changes recorded.</p>}
                    {!live && !readOnly && <Button size="sm" variant="outline" data-testid={`button-rollback-${h.id}`} disabled={rollback.isPending} onClick={() => setConfirm({ id: h.id, version: h.version })}>Roll back to v{h.version}</Button>}
                  </li>);
              })}
            </ol>)}
        </Panel>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent data-testid="dialog-rollback">
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back to v{confirm?.version}?</AlertDialogTitle>
            <AlertDialogDescription>This only switches which saved release the shared-master site shows. It does not activate DNS, domains, financial operations or credentials, and it does not change your draft.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rollback">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-rollback" disabled={rollback.isPending} onClick={(e) => { e.preventDefault(); if (confirm) rollback.mutate(confirm.id); }}>{rollback.isPending ? 'Rolling back' : 'Roll back'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
