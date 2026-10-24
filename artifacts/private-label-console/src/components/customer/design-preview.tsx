import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAttachmentApi, type Att } from '@/lib/wl';
import { DESIGN_PREVIEW_ROOT, MSG_CONFIG, MSG_READY, type DesignPreviewConfig } from '@site/lib/design-preview-bridge';

const SRC = `/private-label-website${DESIGN_PREVIEW_ROOT}`;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Reads the customer's own logo through the authenticated attachment endpoint and keeps it in memory only. */
function useLogoDataUrl(logo: Att | null) {
  const api = useAttachmentApi();
  const [url, setUrl] = useState<string | null>(null);
  const [fail, setFail] = useState(false);
  const id = logo?.id ?? null;
  useEffect(() => {
    setUrl(null); setFail(false);
    if (!id) return;
    let dead = false;
    api.blob(id).then((b) => new Promise<string>((res, rej) => {
      if (!LOGO_TYPES.includes(b.type)) { rej(new Error('type')); return; }
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b);
    })).then((u) => { if (!dead) setUrl(u); }).catch(() => { if (!dead) setFail(true); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return { url, fail };
}

export function StandardDesignPreview({ brandName, primary, accent, theme, logo }: { brandName: string; primary: string; accent: string; theme: DesignPreviewConfig['theme']; logo: Att | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { url: logoDataUrl, fail } = useLogoDataUrl(logo);
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(false);
  const [reload, setReload] = useState(0);
  const config: DesignPreviewConfig = { brandName: brandName.trim(), primary, accent, theme, logoDataUrl };
  const cfgRef = useRef(config); cfgRef.current = config;
  const post = () => frame.current?.contentWindow?.postMessage({ type: MSG_CONFIG, config: cfgRef.current }, window.location.origin);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !frame.current || e.source !== frame.current.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type !== MSG_READY) return;
      setReady(true); post();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWide(false); };
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [wide]);
  useEffect(() => { if (ready) post(); }, [ready, config.brandName, primary, accent, theme, logoDataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className={`space-y-3 ${wide ? 'fixed inset-0 z-50 flex flex-col bg-background p-2 shadow-2xl sm:inset-3 sm:rounded-lg sm:border sm:p-3 md:inset-6' : ''}`} aria-label="Standard design preview" role={wide ? 'dialog' : undefined} aria-modal={wide || undefined} data-testid="panel-design-preview">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-copper">Live preview - Exchange master</p>
          <p className="text-xs text-muted-foreground">The shared Exchange master renderer with your brand, logo and colors. Browse pages and run full simulated Swap and Convert orders from amount to completion. All data is synthetic; nothing is quoted, ordered or saved.</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setReady(false); setReload((n) => n + 1); }} data-testid="button-preview-reset"><RotateCcw className="mr-1.5 h-4 w-4" />Restart</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setWide((w) => !w)} data-testid="button-preview-expand">{wide ? <Minimize2 className="mr-1.5 h-4 w-4" /> : <Maximize2 className="mr-1.5 h-4 w-4" />}{wide ? 'Close full view (Esc)' : 'Full view'}</Button>
      </div>
      {fail && <p className="text-xs text-destructive" data-testid="text-preview-logo-error">Your logo could not be loaded into the preview. The brand initial is shown instead.</p>}
      <div className={`relative overflow-hidden rounded-md border bg-muted ${wide ? 'flex-1' : 'h-[min(80vh,860px)] min-h-[560px]'}`}>
        {!ready && <div className="absolute inset-0 grid place-items-center p-6" aria-busy="true"><div className="w-full max-w-md space-y-3"><div className="h-6 w-1/2 animate-pulse rounded bg-background/70" /><div className="h-40 animate-pulse rounded bg-background/70" /><div className="h-4 w-2/3 animate-pulse rounded bg-background/70" /></div></div>}
        <iframe key={reload} ref={frame} src={SRC} title="Standard Exchange design preview" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" className={`h-full w-full border-0 transition-opacity ${ready ? 'opacity-100' : 'opacity-0'}`} data-testid="frame-design-preview" />
      </div>
    </section>
  );
}
