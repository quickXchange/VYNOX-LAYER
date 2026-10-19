export type FeatureRow = { label: string; value: string };
export const FEATURE_LABEL_MAX = 120;
export const FEATURE_VALUE_MAX = 500;

/** Safely read rows from any plan-like or snapshot item; old snapshots without rows yield []. */
export function readFeatureRows(x: unknown): FeatureRow[] {
  const raw = x && typeof x === 'object' ? (x as { featureRows?: unknown }).featureRows : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const { label, value } = r as Record<string, unknown>;
    if (typeof label !== 'string' || typeof value !== 'string' || !label.trim() || !value.trim()) return [];
    return [{ label, value }];
  });
}

export function featureRowsError(rows: FeatureRow[]): string {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const n = i + 1;
    if (!r.label.trim()) return `Feature row ${n} needs a label`;
    if (!r.value.trim()) return `Feature row ${n} needs a value`;
    if (r.label.trim().length > FEATURE_LABEL_MAX) return `Feature row ${n} label is over ${FEATURE_LABEL_MAX} characters`;
    if (r.value.trim().length > FEATURE_VALUE_MAX) return `Feature row ${n} value is over ${FEATURE_VALUE_MAX} characters`;
  }
  return '';
}

export const cleanFeatureRows = (rows: FeatureRow[]): FeatureRow[] => rows.map((r) => ({ label: r.label.trim(), value: r.value.trim() }));

export function moveRow<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x); return next;
}
