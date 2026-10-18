import { supabaseAuthConfiguration, developmentSupabaseAuth } from "./config";
import { HttpError } from "../../lib/errors";

export interface SupabaseUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: { name?: string };
  factors?: { id: string; factor_type: string; status: string; friendly_name?: string }[];
}
export interface SupabaseTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SupabaseUser;
}

/** No Replit/Clerk calls, browser service-role keys, or caller-selected provider URLs. */
export async function authRequest<T>(path: string, options: {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  accessToken?: string;
} = {}, transport: typeof fetch = fetch): Promise<T> {
  const cfg = supabaseAuthConfiguration();
  if (!/^\/(?:(?:token|otp|signup|recover|resend|verify|user|logout)(?:\?[a-zA-Z0-9_=&-]+)?|factors(?:\/[a-f0-9-]+(?:\/(?:challenge|verify))?)?)$/.test(path))
    throw new Error("Unsupported Supabase authentication endpoint.");
  let response: Response;
  const target = new URL(`${cfg.providerOrigin}/auth/v1${path}`);
  if (["/signup", "/recover", "/resend"].includes(path) || (path === "/user" && options.method === "PUT"))
    target.searchParams.set("redirect_to", `${cfg.origin}/${path === "/recover" ? "reset-password" : "verify-email"}`);
  try {
    response = await transport(target.toString(), {
      method: options.method ?? "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: cfg.apiKey,
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        "Content-Type": "application/json",
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new HttpError(503, "Authentication provider is temporarily unavailable.");
  }
  if (!response.ok) {
    // Provider errors can echo private inputs. Never log them or forward raw bodies.
    const error = await response.json().catch(() => ({})) as { error_code?: string; msg?: string; message?: string };
    const code = error.error_code;
    if (response.status === 429) {
      if (!developmentSupabaseAuth()) throw new HttpError(429, "Too many attempts. Wait before trying again.");
      const header = response.headers.get("retry-after");
      const message = error.msg ?? error.message ?? "";
      const frequency = message.length < 300 && /^For security purposes, you can only request this after ([0-9]+) seconds?\.$/.exec(message);
      // Never forward the provider body: select a known reason and safe numeric delay only.
      const delay = header && /^[0-9]+$/.test(header) ? Number(header) : frequency ? Number(frequency[1]) : 60;
      const floor = /^\/(?:recover|otp|resend|signup)$/.test(path) ? 60 : 1;
      const retry = Math.max(floor, Math.min(3600, delay));
      if (frequency)
        throw new HttpError(429, `An email was recently requested for this address. Wait ${retry} seconds before requesting another.`, retry);
      throw new HttpError(429, `Email or verification requests are temporarily limited. Wait ${retry} seconds before retrying.`, retry);
    }
    if (code === "email_not_confirmed") throw new HttpError(403, "EMAIL_NOT_VERIFIED: Verify your email before signing in.");
    if (code === "invalid_credentials") throw new HttpError(401, "Email or password is incorrect.");
    if (code === "otp_expired" || code === "flow_state_expired")
      throw new HttpError(400, "This confirmation link has expired. Request another.");
    if (code === "mfa_verification_failed" || code === "mfa_challenge_expired")
      throw new HttpError(400, "The authenticator code is invalid or expired.");
    throw new HttpError(response.status >= 500 ? 503 : 400, "Authentication request could not be completed.");
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}
