import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const PRODUCTION_REF = "qcgvhlphalxqzzsxqjhi";
const ORGANIZATION = "cvgreqeceunmyluagnud";
const ORIGIN = "https://www.quicklychan.xyz";
const mailCallback = path => {
  const allowed = ["https://qxlayer-staging.vercel.app", "https://qxlayer-acceptance-vynox3.vercel.app", "https://www.quicklychan.xyz"]
    .map(origin => `(eq .RedirectTo "${origin}/${path}")`).join(" ");
  // Old clients/providers can supply a bare Site URL as RedirectTo. Preserve
  // their path fallback while accepting only exact approved callback URLs.
  return `{{ if or ${allowed} }}{{ .RedirectTo }}{{ else }}{{ .SiteURL }}/${path}{{ end }}`;
};
export const MAIL_TEMPLATES = {
  mailer_subjects_confirmation: "Verify your VYNOX LAYER account",
  mailer_subjects_recovery: "Reset your VYNOX LAYER password",
  mailer_subjects_magic_link: "Your VYNOX LAYER sign-in code",
  mailer_templates_confirmation_content: `<h2>VYNOX LAYER</h2><p>Verify your email address:</p><p><a href="${mailCallback("verify-email")}?token_hash={{ .TokenHash }}&amp;type=signup">Verify email</a></p><p>If you did not request this, ignore this message.</p>`,
  mailer_templates_recovery_content: `<h2>VYNOX LAYER</h2><p><a href="${mailCallback("reset-password")}?token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a></p><p>Your existing Google Authenticator verification is still required. This request does not remove two-factor authentication.</p><p>If you did not request this, ignore this message.</p>`,
  mailer_templates_magic_link_content: '<h2>VYNOX LAYER</h2><p>Your sign-in code is:</p><p style="font-size:28px;font-weight:bold">{{ .Token }}</p><p>Enter it in the VYNOX LAYER login page within 5 minutes. It is single-use. Google Authenticator verification is required next. Do not share this code.</p><p>If you did not request this, ignore this message. This is not a password reset and does not remove two-factor authentication.</p>',
};
const CONFIG_TYPES = {
  site_url: "string", uri_allow_list: "string", disable_signup: "boolean",
  mailer_autoconfirm: "boolean", password_min_length: "number",
  password_required_characters: "string", mfa_totp_enroll_enabled: "boolean",
  mfa_totp_verify_enabled: "boolean", mailer_otp_length: "number",
  ...Object.fromEntries(Object.keys(MAIL_TEMPLATES).map(key => [key, "string"])),
};
const derived = {
  mailer_subjects_custom_contents: ["MAILER_SUBJECTS_CONFIRMATION", "MAILER_SUBJECTS_RECOVERY", "MAILER_SUBJECTS_MAGIC_LINK"],
  mailer_templates_custom_contents: ["MAILER_TEMPLATES_CONFIRMATION_CONTENT", "MAILER_TEMPLATES_RECOVERY_CONTENT", "MAILER_TEMPLATES_MAGIC_LINK_CONTENT"],
};

export function safeProductionFailure(error) {
  const messages = {
    "Explicit new-project Auth preparation approval required.": "APPROVAL_FLAG_MISSING",
    "Independent provisioned Production scope required.": "PROVISIONED_SCOPE_MISMATCH",
    "Live/migration/publishing hold required.": "APPLICATION_HOLD_MISMATCH",
    "Preparation-only boundaries required.": "PREPARATION_BOUNDARY_MISMATCH",
    "Only the approved non-secret Auth fields are writable.": "UNAPPROVED_CONFIG_FIELDS",
    "Exact safe Production policy required.": "POLICY_MISMATCH",
    "Native Production project/organization/health mismatch.": "NATIVE_PROJECT_MISMATCH",
    "Native provider fields unsupported; do not patch.": "UNSUPPORTED_NATIVE_FIELDS",
    "Unexpected anonymous/phone/email policy requires review.": "UNEXPECTED_NATIVE_POLICY",
    "Auth policy/template readback mismatch.": "POLICY_READBACK_MISMATCH",
    "Derived mail override flags mismatch.": "MAIL_OVERRIDE_READBACK_MISMATCH",
    "Unrelated mail override changed.": "UNRELATED_MAIL_OVERRIDE_CHANGED",
    "Unrelated Auth setting changed; review required.": "UNRELATED_SETTING_CHANGED",
  };
  if (Object.hasOwn(messages, error?.message)) return messages[error.message];
  const match = /^PRODUCTION_AUTH_HTTP_([1-5][0-9]{2})$/.exec(error?.message ?? "");
  return match ? `PROVIDER_HTTP_${match[1]}` : "PRIVATE_FAILURE_DETAILS_SUPPRESSED";
}

export async function prepareProductionAuth({ plan, state, request, apply = false }) {
  assert(plan.mode === "NEW_ISOLATED_PROJECT_PREPARATION_ONLY" &&
    plan.projectRef === PRODUCTION_REF && state.productionProjectRef === PRODUCTION_REF &&
    state.phase === "FREE_PROJECT_CREATED_AUTH_NOT_ACTIVATED" &&
    plan.organization === ORGANIZATION && state.organization === ORGANIZATION,
  "Independent provisioned Production scope required.");
  assert(state.liveChangesApproved === false && state.migrateAccountsApproved === false &&
    state.republishApproved === false, "Live/migration/publishing hold required.");
  const constraints = plan.executionConstraints;
  assert(["createOrMigrateAccounts", "changeLiveApplication", "changeDevelopmentOrStagingSettings",
    "activateProductionRuntime", "republish", "reuseDevelopmentOrStagingSmtpKeys"]
    .every(key => constraints?.[key] === false), "Preparation-only boundaries required.");
  const expected = { ...plan.proposedAuthConfig, ...MAIL_TEMPLATES };
  assert(Object.keys(expected).length === Object.keys(CONFIG_TYPES).length &&
    Object.entries(expected).every(([key, value]) => Object.hasOwn(CONFIG_TYPES, key) &&
      typeof value === CONFIG_TYPES[key]), "Only the approved non-secret Auth fields are writable.");
  assert(expected.site_url === ORIGIN &&
    expected.uri_allow_list === `${ORIGIN}/verify-email,${ORIGIN}/reset-password` &&
    expected.disable_signup === true && expected.mailer_autoconfirm === false &&
    expected.password_min_length === 10 &&
    expected.password_required_characters === "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789" &&
    expected.mfa_totp_enroll_enabled === true && expected.mfa_totp_verify_enabled === true &&
    expected.mailer_otp_length === 6, "Exact safe Production policy required.");

  const project = await request("GET", `/projects/${PRODUCTION_REF}`);
  assert((project.ref ?? project.id) === PRODUCTION_REF &&
    project.organization_id === ORGANIZATION && project.status === "ACTIVE_HEALTHY",
  "Native Production project/organization/health mismatch.");
  const path = `/projects/${PRODUCTION_REF}/config/auth`;
  const before = await request("GET", path);
  assert(Object.keys(expected).every(key => Object.hasOwn(before, key) &&
    (typeof before[key] === CONFIG_TYPES[key] ||
      key === "password_required_characters" && before[key] === null)),
  "Native provider fields unsupported; do not patch.");
  assert(before.external_anonymous_users_enabled === false &&
    before.mfa_phone_enroll_enabled === false && before.mfa_phone_verify_enabled === false &&
    before.external_email_enabled === true, "Unexpected anonymous/phone/email policy requires review.");
  // Supabase rejects custom mail templates before custom SMTP exists. Prepare
  // the independent security policy first; defer templates without relaxing it.
  const smtpReady = !!before.smtp_host && !!before.smtp_pass;
  const writable = smtpReady ? expected : plan.proposedAuthConfig;
  const patch = Object.fromEntries(Object.entries(writable).filter(([key, value]) => before[key] !== value));
  if (apply && Object.keys(patch).length) await request("PATCH", path, patch);
  const after = apply ? await request("GET", path) : before;
  if (apply) {
    assert(Object.entries(writable).every(([key, value]) => after[key] === value), "Auth policy/template readback mismatch.");
    for (const [key, flags] of smtpReady ? Object.entries(derived) : []) {
      assert(flags.every(flag => after[key]?.[flag] === true), "Derived mail override flags mismatch.");
      const otherFlags = new Set([...Object.keys(before[key] ?? {}), ...Object.keys(after[key] ?? {})]);
      assert([...otherFlags].every(flag => flags.includes(flag) ||
        JSON.stringify(before[key]?.[flag]) === JSON.stringify(after[key]?.[flag])),
      "Unrelated mail override changed.");
    }
    const all = new Set([...Object.keys(before), ...Object.keys(after)]);
    assert([...all].every(key => Object.hasOwn(writable, key) || smtpReady && Object.hasOwn(derived, key) ||
      JSON.stringify(before[key]) === JSON.stringify(after[key])), "Unrelated Auth setting changed; review required.");
  }
  const pendingFields = Object.entries(expected).filter(([key, value]) => after[key] !== value).map(([key]) => key);
  const templatesVerified = Object.entries(MAIL_TEMPLATES).every(([key, value]) => after[key] === value);
  return { projectRef: PRODUCTION_REF, environment: "production", applied: apply,
    status: !apply ? "READ_ONLY_VERIFICATION" : smtpReady
      ? "CORE_AND_TEMPLATES_PREPARED_DELIVERY_UNVERIFIED" : "CORE_PREPARED_CUSTOM_SMTP_REQUIRED",
    changedFields: apply ? Object.keys(patch) : [],
    pendingFields, nativeReadbackVerified: apply,
    signupDisabled: after.disable_signup === true, confirmationRequired: after.mailer_autoconfirm === false,
    totpEnabled: after.mfa_totp_enroll_enabled === true && after.mfa_totp_verify_enabled === true,
    otpLength: after.mailer_otp_length, passwordMinimum: after.password_min_length,
    exactRedirectsVerified: after.uri_allow_list === expected.uri_allow_list,
    templatesVerified, unrelatedSettingsPreserved: apply,
    smtpConfigured: !!after.smtp_host && !!after.smtp_pass, nativeEmailDeliveryVerified: false,
    nativeOwnerAcceptanceVerified: false, applicationRuntimeActivated: false,
    accountsCreatedOrMigrated: false, liveModified: false, republished: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2] ?? "verify";
    assert(["verify", "apply"].includes(mode), "Use verify or apply.");
    const apply = mode === "apply";
    assert(!apply || process.env.QXLAYER_ISOLATED_PRODUCTION_AUTH_PREPARATION_APPROVED === "true",
      "Explicit new-project Auth preparation approval required.");
    const plan = JSON.parse(await readFile("deploy/production-supabase-auth-bootstrap.json", "utf8"));
    const state = JSON.parse(await readFile(".local/free-production-provisioning.json", "utf8"));
    const token = process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SETUP_TOKEN;
    assert(token && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "Scoped setup token and verified TLS required.");
    const request = async (method, path, body) => {
      assert((method === "GET" && [`/projects/${PRODUCTION_REF}`, `/projects/${PRODUCTION_REF}/config/auth`].includes(path)) ||
        (apply && method === "PATCH" && path === `/projects/${PRODUCTION_REF}/config/auth`),
      "Operation outside new Production Auth scope.");
      const response = await fetch(`https://api.supabase.com/v1${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error", signal: AbortSignal.timeout(30000),
      });
      assert(response.ok, `PRODUCTION_AUTH_HTTP_${response.status}`);
      return response.json();
    };
    const report = await prepareProductionAuth({ plan, state, request, apply });
    await mkdir("generated-artifacts/auth-security", { recursive: true });
    await writeFile("generated-artifacts/auth-security/production-auth-config-readback.json",
      JSON.stringify({ ...report, capturedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } catch (error) {
    const code = safeProductionFailure(error);
    await mkdir(".local", { recursive: true }).then(() => writeFile(
      ".local/production-auth-preparation-diagnostic.json",
      JSON.stringify({ code, capturedAt: new Date().toISOString(), credentialDetailsStored: false }) + "\n",
      { mode: 0o600 })).catch(() => {});
    console.error(`Production Auth preparation stopped (${code}); private inputs/errors suppressed. Do not activate or publish.`);
    process.exitCode = 1;
  }
}
