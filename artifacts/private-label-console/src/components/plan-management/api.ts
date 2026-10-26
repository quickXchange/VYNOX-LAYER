import { useQueryClient } from '@tanstack/react-query';
import { useMigratePlanSubscriptions, useReorderPlans, useRollbackPublication, getListPublicationVersionsQueryKey } from '@workspace/api-client-react';

/** Mutations with shared cache invalidation; all endpoints come from the OpenAPI contract. */
export function usePmMutations() {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: getListPublicationVersionsQueryKey() }); qc.invalidateQueries({ queryKey: ['commerce', 'pricing-publication'] }); };
  return {
    rollback: useRollbackPublication({ mutation: { onSuccess: done } }),
    reorder: useReorderPlans({ mutation: { onSuccess: done } }),
    migrate: useMigratePlanSubscriptions({ mutation: { onSuccess: () => qc.invalidateQueries() } }),
  };
}
