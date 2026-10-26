import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useAttachmentApi, type Att } from '@/lib/wl';
import { closedMessage, configMessage, newPreviewId, parseBridgeMessage, previewChannelName, previewHref, MSG_READY, type DesignPreviewConfig } from '@site/lib/design-preview-bridge';

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

/**
 * Opens the shared master renderer as a full-page simulation in a new tab (no iframe).
 * Branding travels over a same-origin BroadcastChannel scoped by a random per-preview nonce;
 * the logo is sent as an in-memory data URL only while this page is mounted.
 */
export function StandardDesignPreview({ brandName, primary, accent, theme, logo }: { brandName: string; primary: string; accent: string; theme: DesignPreviewConfig['theme']; logo: Att | null }) {
  const { url: logoDataUrl, fail } = useLogoDataUrl(logo);
  const [id] = useState(() => newPreviewId());
  const supported = typeof BroadcastChannel !== 'undefined';
  const config: DesignPreviewConfig = { brandName: brandName.trim(), primary, accent, theme, logoDataUrl };
  const cfgRef = useRef(config); cfgRef.current = config;
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!supported) return;
    const ch = new BroadcastChannel(previewChannelName(id));
    chRef.current = ch;
    ch.onmessage = (e) => { if (parseBridgeMessage(e.data, id)?.type === MSG_READY) ch.postMessage(configMessage(id, cfgRef.current)); };
    return () => { ch.postMessage(closedMessage(id)); ch.close(); chRef.current = null; };
  }, [id, supported]);
  useEffect(() => { chRef.current?.postMessage(configMessage(id, cfgRef.current)); }, [id, config.brandName, primary, accent, theme, logoDataUrl]);

  return (
    <section className="space-y-2 rounded-md border bg-muted/30 p-4" aria-label="Standard design preview" data-testid="panel-design-preview">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-copper">Preview - NovaX Exchange master (simulation)</p>
      <a href={previewHref('/private-label-website', id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-base font-medium text-primary underline underline-offset-4 hover:no-underline" data-testid="link-design-preview">
        You can see your preview here<ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
      </a>
      <p className="text-xs text-muted-foreground">Opens the full website with your brand, logo and colors in a new tab, plus a demo admin panel. Run Swap and Convert orders to completion and manage them in the admin. All data is synthetic: no real payments, quotes, blockchain, providers or notifications. Demo records live only in that tab's memory and clear on reload or reset. Keep this page open for live branding updates.</p>
      {!supported && <p className="text-xs text-destructive" data-testid="text-preview-unsupported">This browser cannot link the preview to your draft, so it will show the NovaX sample brand.</p>}
      {fail && <p className="text-xs text-destructive" data-testid="text-preview-logo-error">Your logo could not be loaded into the preview. The brand initial is shown instead.</p>}
    </section>
  );
}
