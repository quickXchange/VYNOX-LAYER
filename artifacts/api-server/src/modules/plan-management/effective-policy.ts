/** Catalog marketing can request future services, but cannot implement them. */
// Capabilities with no live backend implementation fail closed regardless of editable copy.
export const UNSUPPORTED_CAPABILITIES = ['best_rate_routing', 'fiat_ramps', 'monitor_exports', 'affiliates', 'languages', 'analytics', 'aml_kyc_rules', 'merchant_gateway', 'pair_markup', 'multi_admin_roles'];
const granted = (cap: any) => !['excluded', 'unavailable'].includes(cap.state ?? (cap.included === true ? 'included' : 'excluded'));

export function applyPlanPolicy(profile: Record<string, any> | undefined, features: Record<string, boolean>, limits: Record<string, string>, sources: Record<string, string>) {
  if (!profile || !profile.slug) return; // Legacy (empty-profile) contracts retain their existing rules unchanged.
  const capabilities = Array.isArray(profile.capabilities) ? profile.capabilities : [];
  for (const cap of capabilities) {
    if (typeof cap?.key !== 'string') continue;
    const key = cap.key === 'api_access' ? 'api_keys' : cap.key;
    features[key] = granted(cap) && cap.availability === 'available' && !UNSUPPORTED_CAPABILITIES.includes(cap.key);
    sources[key] = 'frozen plan capability';
  }
  for (const key of [...UNSUPPORTED_CAPABILITIES, 'buy', 'sell']) { features[key] = false; sources[key] = 'not implemented: denied'; }
  features.powered_by_footer = profile.poweredByFooter === true;
  // Themes: a contract that lists theme modes may only use those modes.
  if (Array.isArray(profile.themeModes)) for (const m of ['light', 'dark']) features[`theme_${m}`] = profile.themeModes.includes(m);
  // Languages are not implemented for profile plans: a single site language.
  limits.max_languages = '1';
  if (Number.isInteger(profile.adminSeats) && profile.adminSeats >= 1) limits.max_staff = String(profile.adminSeats - 1);
  if (Number.isInteger(profile.convertProviderLimit) && profile.convertProviderLimit >= 0) limits.max_convert_providers = String(profile.convertProviderLimit);
  // Dependencies only remove access; iterate to a fixed point (cycles cannot grant).
  for (let i = 0; i < capabilities.length; i++) for (const cap of capabilities) {
    const deps = Array.isArray(cap.dependsOn) ? cap.dependsOn : Array.isArray(cap.dependencies) ? cap.dependencies : [];
    const key = cap.key === 'api_access' ? 'api_keys' : cap.key;
    if (deps.some((d: string) => !features[d === 'api_access' ? 'api_keys' : d])) features[key] = false;
  }
}
