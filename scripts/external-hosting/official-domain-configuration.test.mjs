import test from "node:test";
import assert from "node:assert/strict";
import { authDomainPatch, DOMAIN_ENV, PRIMARY } from "./official-domain-configuration.mjs";
const before = {
  site_url: "https://qxlayer-acceptance-vynox3.vercel.app",
  uri_allow_list: "https://www.quicklychan.xyz/reset-password,https://qxlayer-acceptance-vynox3.vercel.app/reset-password",
  mfa_totp_verify_enabled: true,
  mailer_templates_confirmation_content: '{{ if or (eq .RedirectTo "https://www.quicklychan.xyz/verify-email") }}{{ .RedirectTo }}{{ else }}{{ .SiteURL }}/verify-email{{ end }}',
  mailer_templates_recovery_content: '{{ if or (eq .RedirectTo "https://www.quicklychan.xyz/reset-password") }}{{ .RedirectTo }}{{ else }}{{ .SiteURL }}/reset-password{{ end }} Keep your authenticator.',
};
test("domain configuration extends exact callbacks without changing identity/security fields", () => {
  const patch = authDomainPatch(before);
  assert.equal(patch.site_url, PRIMARY);
  for (const url of before.uri_allow_list.split(",")) assert(patch.uri_allow_list.split(",").includes(url));
  assert(patch.uri_allow_list.includes(`${PRIMARY}/reset-password`));
  assert(patch.mailer_templates_recovery_content.endsWith("Keep your authenticator."));
  assert.equal(Object.keys(patch).length, 4);
  assert.deepEqual(authDomainPatch({ ...before, ...patch }), patch);
  assert.equal(Object.keys(DOMAIN_ENV).length, 4);
  assert.throws(() => authDomainPatch({ ...before, mfa_totp_verify_enabled: false }));
  assert.throws(() => authDomainPatch({ ...before, mailer_templates_recovery_content: "unreviewed" }));
});
