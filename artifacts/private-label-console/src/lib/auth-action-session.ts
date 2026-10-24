import type { SupabaseActionInput, SupabaseActionResult, SupabaseSession } from "@workspace/api-client-react";

/** HTTP success is not proof that this browser retained the new authentication session. */
export function authActionSessionError(input: SupabaseActionInput, session: SupabaseSession, result?: SupabaseActionResult): string | null {
  if (input.action === "login-email-send" &&
      (!result?.emailLoginChallengeExpiresAt ||
       session.emailLoginChallengeExpiresAt !== result.emailLoginChallengeExpiresAt))
    return "This browser did not retain the secure sign-in challenge. The embedded preview may be blocking cookies. Open Development sign-in in a new tab and request a new code there.";
  if (input.action === "login" || input.action === "login-email-verify") {
    if (!session.user || session.recovery ||
        session.user.email.toLowerCase() !== input.email?.trim().toLowerCase())
      return "The sign-in session was not retained in this browser. Open Development in one browser tab and sign in again. Allow its secure cookies.";
    if (input.action === "login-email-verify" &&
        ((session.user.twoFactorEnabled && !session.mfaRequired) ||
         (typeof result?.mfaRequired === "boolean" && result.mfaRequired !== session.mfaRequired)))
      return "The required authenticator step could not be confirmed. Sign in again.";
  }
  if (input.action === "mfa-verify" || input.action === "mfa-email-verify") {
    if (!session.user)
      return "Your pending sign-in session is no longer available. Sign in again before entering a new code.";
    if (session.mfaRequired || (input.action === "mfa-email-verify" && session.recovery))
      return "Verification could not be confirmed for this browser session. Sign in again before continuing.";
  }
  return null;
}
