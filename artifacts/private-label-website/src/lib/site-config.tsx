import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { migrateSiteSnapshot, type SiteSnapshotConfig } from '@workspace/api-zod';
import { websitePreviewRequest } from './development-preview';

export const SiteConfigContext = createContext<SiteSnapshotConfig | null>(null);
export const useCurrentSiteConfig = () => useContext(SiteConfigContext);
export function useReleasedSiteConfig(slug: string) {
  const request = websitePreviewRequest(slug);
  const preview = !!request.headers?.['X-QX-Release-Preview'] || !!request.headers?.['X-QX-Website-Preview'];
  return useQuery({
    queryKey: ['released-site-config', slug, preview ? 'draft' : 'live'],
    queryFn: async () => {
      const r = await fetch(`/api/public/site-config?slug=${encodeURIComponent(slug)}`, { ...request, credentials: 'include', cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status === 404 ? 'Site not found or not released.' : r.status === 403 || r.status === 401 ? 'Draft preview permission is missing or expired.' : 'Site configuration could not be loaded.');
      return migrateSiteSnapshot(await r.json());
    },
    enabled: !!slug, retry: false, staleTime: 0, refetchOnMount: 'always',
    refetchInterval: 15_000, refetchIntervalInBackground: true, refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
}
