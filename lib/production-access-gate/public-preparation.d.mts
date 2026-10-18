export const PUBLIC_PREPARATION_ORIGIN: "https://qxlayer-staging.vercel.app";
export const OFFICIAL_PRODUCTION_ORIGIN: "https://vynoxlayer.com";
export function publicPreparation(env?: NodeJS.ProcessEnv): boolean;
export function publicAuthOriginAllowed(origin: string | undefined, configured: string, env?: NodeJS.ProcessEnv): boolean;
