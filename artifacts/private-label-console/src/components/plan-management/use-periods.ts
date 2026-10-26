import { useQuery } from '@tanstack/react-query';
import { useCommerceApi } from '@/components/commerce/api';
type Periods = { monthly: boolean; yearly: boolean };
/** Shares the cache key with the billing periods editor so client-side billing checks stay in sync. */
export function usePlanPeriods(planId?: string) {
  const call = useCommerceApi();
  return useQuery({ queryKey: ['phase1-periods', planId], enabled: !!planId, retry: 1, queryFn: () => call<Periods>('GET', `/operator/phase1/plans/${planId}/periods`) });
}
