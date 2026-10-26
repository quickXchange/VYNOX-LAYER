export type Trial = {
  id: string;
  state: "active" | "cancelled" | "expired";
  startedAt: string;
  endsAt: string;
  renewalRule: "manual_agreement_required";
  renewalRequestedAt: string | null;
  cancelledAt: string | null;
  publishedRevision: string;
  agreedRecurringPrice: string;
};

/** Deadline is authoritative even when the expiry worker is stopped. */
export function effectiveTrial(trial: Trial | null | undefined, now = new Date()): Trial | null {
  if (!trial) return null;
  return { ...trial, state: trial.state === "active" && new Date(trial.endsAt).getTime() <= now.getTime() ? "expired" : trial.state };
}
export function trialBlocksAccess(trial: Trial | null | undefined, now = new Date()) {
  const current = effectiveTrial(trial, now);
  return !!current && current.state !== "active";
}
