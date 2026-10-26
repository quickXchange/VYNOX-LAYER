#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
# Leaf projects consume emitted shared declarations, not only the changed source.
pnpm run typecheck:libs
# Never perform an unrestricted schema push against an inherited database URL.
# This additive runner independently requires the Development heliumdb target.
if [[ "${QXLAYER_EXTERNAL_ENVIRONMENT:-}" == "development" ]]; then
  NODE_ENV=development pnpm --filter @workspace/scripts exec tsx src/apply-subscription-trials.mjs
fi
