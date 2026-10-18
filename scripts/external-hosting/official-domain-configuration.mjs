import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const PRIMARY = "https://vynoxlayer.com";
export const DOMAIN_ENV = {
  QXLAYER_VYNOX_DOMAIN_CONNECTION_APPROVED: "true",
  QXLAYER_PUBLIC_PRODUCTION_ORIGIN: PRIMARY,
  QXLAYER_PLATFORM_URL: PRIMARY,
  QXLAYER_PRODUCTION_SUPABASE_AUTH_URL: PRIMARY,
};

/** Preserve policy, credentials, custom mail text and every existing callback. */
export function authDomainPatch(before) {
  assert(before.mfa_totp_verify_enabled === true, "Existing authenticator policy required");
  const redirects = new Set((before.uri_allow_list ?? "").split(",").filter(Boolean));
  for (const path of ["verify-email", "reset-password"]) redirects.add(`${PRIMARY}/${path}`);
  const patch = { site_url: PRIMARY, uri_allow_list: [...redirects].join(",") };
  for (const [key, path] of [
    ["mailer_templates_confirmation_content", "verify-email"],
    ["mailer_templates_recovery_content", "reset-password"],
  ]) {
    const template = before[key];
    assert(typeof template === "string" && template.includes("{{ if or ") &&
      template.includes("{{ .RedirectTo }}"), "Existing redirect-safe mail template required");
    patch[key] = template.includes(`(eq .RedirectTo "${PRIMARY}/${path}")`) ? template :
      template.replace("{{ if or ", `{{ if or (eq .RedirectTo "${PRIMARY}/${path}") `);
  }
  return patch;
}

async function configure() {
  assert(process.env.VYNOX_OFFICIAL_DOMAIN_CONFIGURATION_APPROVED === "true");
  async function call(url, token, method = "GET", body) {
    const response = await fetch(url, {
      method, redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(response.ok, `Official-domain provider operation HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  // The dedicated project-settings token, not a general organization token.
  const authUrl = "https://api.supabase.com/v1/projects/qcgvhlphalxqzzsxqjhi/config/auth";
  const authToken = process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SETUP_TOKEN;
  const beforeAuth = await call(authUrl, authToken);
  const patch = authDomainPatch(beforeAuth);
  await call(authUrl, authToken, "PATCH", patch);
  const afterAuth = await call(authUrl, authToken);
  for (const [key, value] of Object.entries(patch)) assert.deepEqual(afterAuth[key], value);
  for (const key of Object.keys(beforeAuth))
    if (!Object.hasOwn(patch, key)) assert.deepEqual(afterAuth[key], beforeAuth[key], `Unrelated Auth field changed: ${key}`);
  const renderUrl = "https://api.render.com/v1/services/srv-dba0q0gm7kps73f1k9fg/env-vars";
  const renderToken = process.env.RENDER_API_KEY;
  const envMap = entries => Object.fromEntries(entries.map(x => {
    const item = x.envVar ?? x; return [item.key, item.value];
  }));
  const beforeEnv = envMap(await call(renderUrl + "?limit=100", renderToken));
  assert(beforeEnv.QXLAYER_FINANCIAL_EXECUTION_ENABLED === "false" &&
    beforeEnv.QXLAYER_OFFICIAL_DOMAIN_CONNECTION_APPROVED === "true" &&
    beforeEnv.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "false");
  for (const [key, value] of Object.entries(DOMAIN_ENV))
    await call(`${renderUrl}/${key}`, renderToken, "PUT", { value });
  const afterEnv = envMap(await call(renderUrl + "?limit=100", renderToken));
  for (const [key, value] of Object.entries(DOMAIN_ENV)) assert.equal(afterEnv[key], value);
  for (const key of Object.keys(beforeEnv))
    if (!Object.hasOwn(DOMAIN_ENV, key)) assert.equal(afterEnv[key], beforeEnv[key], `Unrelated Render field changed: ${key}`);
  console.log(JSON.stringify({ primary: PRIMARY, authCallbacksExtended: true,
    legacyCallbacksPreserved: true, authPolicyAndCredentialsPreserved: true,
    renderConfigurationReadyForWorkflowDeployment: true, financialExecutionEnabled: false,
    accountsChanged: false, dnsChanged: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  configure().catch(() => {
    console.error("Official-domain configuration failed; provider credential details suppressed.");
    process.exitCode = 1;
  });
