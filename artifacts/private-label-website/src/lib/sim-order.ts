/**
 * Local-only simulated order flow for the isolated design preview.
 * Pure functions: no network, no storage, no real quotes, orders or payment data.
 */
export type SimStage = 'amount' | 'details' | 'review' | 'done';
export const SIM_STAGES: SimStage[] = ['amount', 'details', 'review', 'done'];
export const SIM_FEE_RATE = 0.0035;
export const SIM_MIN_FIAT = 25;
export const SIM_MAX_FIAT = 25000;

export interface SimDetails { fullName: string; email: string; destination: string; agree: boolean }
export const SAMPLE_DETAILS: SimDetails = { fullName: 'Sample Customer', email: 'customer@example.test', destination: 'sample-wallet-0000-demo', agree: false };

export interface SimQuote { gross: number; fee: number; net: number; rate: number; fiatValue: number }

/** Synthetic math. `fiatIn`: true when the user pays fiat for crypto. */
export function simQuote(opts: { amount: number; fromPrice: number; toPrice?: number; convert: boolean; fiatIn: boolean }): SimQuote | null {
  const { amount, fromPrice, toPrice, convert, fiatIn } = opts;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!ok(amount) || !ok(fromPrice) || (convert && !ok(toPrice))) return null;
  const rate = convert ? fromPrice / toPrice! : fromPrice;
  const gross = convert ? amount * rate : fiatIn ? amount / rate : amount * rate;
  const fee = gross * SIM_FEE_RATE;
  const fiatValue = convert || !fiatIn ? amount * fromPrice : amount;
  if (![rate, gross, fiatValue].every(Number.isFinite)) return null;
  return { gross, fee, net: gross - fee, rate, fiatValue };
}

export const SIM_DEFAULT_FIAT = 250;
/** Sample amount worth about 250 fiat in the input currency. */
export function sampleAmount(inputIsFiat: boolean, fromPrice: number): string {
  if (inputIsFiat || !(Number.isFinite(fromPrice) && fromPrice > 0)) return String(SIM_DEFAULT_FIAT);
  return String(Number((SIM_DEFAULT_FIAT / fromPrice).toPrecision(4)));
}

export function amountError(amount: string, fiatValue: number | null): string | null {
  const n = Number(amount);
  if (amount.trim() === '' || !Number.isFinite(n) || !(n > 0)) return 'Enter an amount greater than zero.';
  if (fiatValue != null && !Number.isFinite(fiatValue)) return 'Enter a valid sample amount.';
  if (fiatValue != null && fiatValue < SIM_MIN_FIAT) return `Sample minimum is ${SIM_MIN_FIAT} fiat.`;
  if (fiatValue != null && fiatValue > SIM_MAX_FIAT) return `Sample maximum is ${SIM_MAX_FIAT.toLocaleString('en-US')} fiat.`;
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function detailsErrors(d: SimDetails): Partial<Record<keyof SimDetails, string>> {
  const e: Partial<Record<keyof SimDetails, string>> = {};
  if (d.fullName.trim().length < 2) e.fullName = 'Enter a sample name.';
  if (!EMAIL.test(d.email.trim())) e.email = 'Enter a sample email address.';
  if (d.destination.trim().length < 6) e.destination = 'Enter a sample reference of at least 6 characters.';
  return e;
}

export function next(stage: SimStage): SimStage { return SIM_STAGES[Math.min(SIM_STAGES.indexOf(stage) + 1, 3)]; }
export function back(stage: SimStage): SimStage { return stage === 'done' ? 'done' : SIM_STAGES[Math.max(SIM_STAGES.indexOf(stage) - 1, 0)]; }

/** Deterministic synthetic reference, clearly marked as a simulation. */
export function simRef(run: number): string { return `SIM-${String(1000 + run).padStart(6, '0')}`; }
