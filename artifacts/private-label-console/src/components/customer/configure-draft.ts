import { initialCfg, STEPS, type Cfg } from './configure-state';

export type IntakeDraft = { cfg: Cfg; step: number; maxStep: number; key: string; savedAt: number };
export const draftKey = (userId: string) => `vynox-exchange-intake-v1:${userId}`;
export function readDraft(storage: Pick<Storage, 'getItem'>, userId: string): IntakeDraft | null {
  try {
    const raw = storage.getItem(draftKey(userId));
    if (!raw || raw.length > 200000) return null;
    const d = JSON.parse(raw);
    if (!d || !d.cfg || typeof d.key !== 'string' || !/^[0-9a-f-]{36}$/i.test(d.key) ||
      !Number.isFinite(d.savedAt) || Date.now() - d.savedAt > 86400000 ||
      !Number.isInteger(d.step) || !Number.isInteger(d.maxStep) ||
      d.step < 0 || d.maxStep < d.step || d.maxStep >= STEPS.length) return null;
    for (const [name, value] of Object.entries(initialCfg())) {
      const candidate = d.cfg[name];
      if (typeof value === 'string' && typeof candidate !== 'string') return null;
      if (Array.isArray(value) && !Array.isArray(candidate)) return null;
    }
    if (!d.cfg.acts.every((s: unknown) => s === 'swap' || s === 'convert') ||
      !d.cfg.addonIds.every((s: unknown) => typeof s === 'string') ||
      (d.cfg.convertProviders && (!Array.isArray(d.cfg.convertProviders) ||
        !d.cfg.convertProviders.every((s: unknown) => typeof s === 'string')))) return null;
    const files = [d.cfg.logo, ...d.cfg.refs, ...d.cfg.reqFiles].filter(Boolean);
    if (!files.every(f => typeof f.id === 'string' && typeof f.fileName === 'string' && Number.isFinite(f.size))) return null;
    return d;
  } catch { return null; }
}
