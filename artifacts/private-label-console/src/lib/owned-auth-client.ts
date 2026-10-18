import { supabaseFacade } from "@/lib/supabase-auth-client";

const provider = import.meta.env.VITE_QXLAYER_AUTH_PROVIDER;
const environment = import.meta.env.VITE_QXLAYER_EXTERNAL_ENVIRONMENT;
export const supabaseDevelopmentAuth = provider === "supabase" && environment === "development";
const production = provider === "supabase" && environment === "production";
if (production && (
    !/^[a-z0-9]{20}$/.test(import.meta.env.VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF ?? "") ||
    ["nktstksmfpcsjnjbeqsk", "muvedavhbpgpdrrnjrih"].includes(import.meta.env.VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF) ||
    import.meta.env.VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_URL !==
      (import.meta.env.VITE_QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "true" ?
        "https://qxlayer-acceptance-vynox3.vercel.app" :
        import.meta.env.VITE_QXLAYER_PUBLIC_PREPARATION_APPROVED === "true" ?
          (import.meta.env.VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_URL === "https://www.quicklychan.xyz" ?
            "https://www.quicklychan.xyz" : "https://qxlayer-staging.vercel.app") : "https://www.quicklychan.xyz"))) {
  throw new Error("Production Supabase authentication requires its isolated project and canonical Live origin.");
}
if (supabaseDevelopmentAuth && (!import.meta.env.DEV ||
    import.meta.env.VITE_QXLAYER_DEVELOPMENT_SUPABASE_AUTH_PROJECT_REF !== "nktstksmfpcsjnjbeqsk" ||
    !/^https:\/\/[a-z0-9.-]+\.replit\.dev$/.test(import.meta.env.VITE_QXLAYER_DEVELOPMENT_SUPABASE_AUTH_URL ?? ""))) {
  throw new Error("Development Supabase authentication requires its pinned project and exact Development preview origin.");
}
// Public rendering also works through the internal preview proxy. The server,
// not the rendering host, enforces the exact approved origin for auth mutations.
if (provider === "supabase" && environment !== "staging" && !supabaseDevelopmentAuth && !production) {
  throw new Error("Supabase authentication requires an explicit isolated environment.");
}
/** Production rendering support is not authority to activate or publish the server. */
export const supabaseAuth = provider === "supabase" && (environment === "staging" || supabaseDevelopmentAuth || production);
/** Retained name for the shared account UI, now exclusively Supabase. */
export const ownedAuth = supabaseAuth;
if (!supabaseAuth) throw new Error("Supabase authentication is required. Legacy authentication is retired; Production migration approval is required before publishing.");
export const authClient = supabaseFacade;
