import type { Att } from '@/lib/wl';

export type Cfg = {
  projectName: string; websiteName?: string; brandName: string; companyName: string; domain: string;
  designType: 'standard' | 'custom'; logo: Att | null; primary: string; accent: string; theme: 'light' | 'dark' | 'both';
  styleName: string; description: string; refUrl: string; notes: string; refs: Att[];
  acts: string[]; convertProviders?: string[]; planId: string; addonIds: string[]; period: 'monthly' | 'yearly'; details: string; reqFiles: Att[];
};
export const initialCfg = (): Cfg => ({ projectName: '', brandName: '', companyName: '', domain: '', designType: 'standard', logo: null, primary: '#12423f', accent: '#b4551f', theme: 'light', styleName: '', description: '', refUrl: '', notes: '', refs: [], acts: ['swap'], planId: '', addonIds: [], period: 'monthly', details: '', reqFiles: [] });
export const STEPS = ['Project', 'Design', 'Features', 'Plan', 'Add-ons', 'Requirements', 'Review'] as const;
export const ACTS = ['swap', 'convert'] as const;
export const CONVERT_PROVIDERS = [{ id: 'quickex', label: 'Quickex' }, { id: 'changenow', label: 'ChangeNOW' }] as const;
export const providerNames = (c: Cfg) => CONVERT_PROVIDERS.filter(p => c.convertProviders?.includes(p.id)).map(p => p.label);
// Persist intake preferences in the existing operator-visible requirements field.
// This is a service request, not a connection or execution configuration.
export const requestDetails = (c: Cfg) => c.acts.includes('convert')
  ? [`Requested Convert providers: ${providerNames(c).join(', ')} (subject to operator review and setup).`, c.details].filter(Boolean).join('\n\n')
  : c.details;
export type StepProps = { cfg: Cfg; set: (p: Partial<Cfg> | ((c: Cfg) => Partial<Cfg>)) => void; onBusy: (d: number) => void };
export const stepError = (i: number, c: Cfg): string => {
  if ((i === 1 || i === 5) && fileError(c)) return fileError(c);
  if (i === 0) return c.brandName.trim().length < 2 ? 'Brand name needs 2+ characters' : !c.domain.trim() ? 'Preferred domain is required' : '';
  if (i === 1) return c.designType === 'custom' && c.styleName.trim().length < 2 ? 'Give your custom style a name' : c.refUrl.trim() && !/^https?:\/\/\S+$/i.test(c.refUrl.trim()) ? 'Reference website must start with http:// or https://' : '';
  if (i === 2) return c.acts.length === 0 ? 'Choose at least one feature' : c.acts.includes('convert') && !providerNames(c).length ? 'Choose at least one Convert provider' : '';
  if (i === 3) return c.planId ? '' : 'Select a plan';
  if (i === 5) return requestDetails(c).length > 10000 ? 'Requirements, including provider preferences, are limited to 10000 characters' : '';
  return '';
};

export const fileError = (c: Cfg): string => {
  const all = [c.logo, ...c.refs, ...c.reqFiles].filter((x) => x != null);
  if (all.length > 20) return 'An order can have at most 20 files';
  if (all.reduce((n, x) => n + x.size, 0) > 40 * 1048576) return 'An order can hold at most 40 MB of files in total';
  return '';
};
