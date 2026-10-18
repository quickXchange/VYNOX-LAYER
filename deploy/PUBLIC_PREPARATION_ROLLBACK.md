# Pre-DNS Production hold and rollback

## Boundaries

- Temporary public hostname: `https://qxlayer-staging.vercel.app`.
- Protected acceptance: `https://qxlayer-acceptance-vynox3.vercel.app`.
- Dedicated public API: `https://vynox-public-api.onrender.com`.
- The two APIs have separate database login passwords and session keys.
  They intentionally retain the same Production user directory and tenant data
  to preserve the original Owner, verified MFA and customer identities.
- Neither official hostname may have a deployment alias during preparation.
  Automatic custom-domain assignment remains disabled.
- Do not restore an old database over current records. No data rollback is part
  of a frontend/API rollback.

## Containment if the temporary public release fails

1. Stop the manual public-preparation workflow before another release.
2. Restore Vercel project protection to `all_except_custom_domains` to protect
   the temporary `vercel.app` hostname. Preview/acceptance remains protected.
3. Remove only the temporary Production alias if withdrawal is necessary.
   Never remove or replace the acceptance alias.
4. Hold only `vynox-public-api` using the existing held-candidate startup path:
   public-preparation approval false, candidate true, startup approval false,
   acceptance approval false and the private access gate enabled. Redeploy the
   reviewed source. The public service does not have privileged preflight
   database credentials; missing readiness evidence must remain a failure.
5. Leave the acceptance API, Supabase data, original Owner credentials,
   authenticators and registrar DNS untouched.
6. Verify protected acceptance and its API independently before further work.

These steps are a documented contingency, not an action already performed.
Suspending, deleting or adding paid services is not an automatic recovery step.

## Final-switch prerequisites

- Obtain the original Owner's native sign-in and authenticator confirmation;
  disposable QA administrators are not substitutes.
- Obtain explicit final-switch approval.
- Back up the complete registrar zone. Existing public A records are not a
  full zone export; preserve mail records and existing verification TXT.
- Release and verify canonical-origin frontend/API configuration as one unit.
  Do not simply change DNS while the running build is pinned to the temporary
  origin or toggle held configuration flags without reviewing their guards.
- Assign only the approved final deployment to the official hostnames, confirm
  HTTPS and the apex-to-www redirect, then perform the approved DNS changes.
- Keep real financial execution disabled until separately authorized.
