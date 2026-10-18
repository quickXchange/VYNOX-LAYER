import { useState } from 'react';
import { useLocation } from 'wouter';
import { authClient, supabaseDevelopmentAuth } from '@/lib/owned-auth-client';
import { A, AuthFrame, ErrorLine, Field, Form, MailNotice, SuccessLine, Submit, authErrorText, isMailUnavailable, useOwnedStatus } from '@/components/auth/auth-ui';
import { StagingSignInGate } from '@/components/auth/staging-auth-navigation';
import { useAuthCooldown } from '@/components/auth/use-auth-cooldown';

export default function SignInPage() {
  return <StagingSignInGate><SignInForm /></StagingSignInGate>;
}

function SignInForm() {
  const [, nav] = useLocation();
  const { status, failed } = useOwnedStatus();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [needsVerify, setNeedsVerify] = useState(false); const [sent, setSent] = useState('');
  const [emailMethod, setEmailMethod] = useState(false);
  const [code, setCode] = useState('');
  const resendWait = useAuthCooldown();
  const verifyWait = useAuthCooldown();
  const passwordWait = useAuthCooldown();
  const sendCode = async () => {
    if (busy || resendWait.remaining) return;
    setBusy(true); setErr(''); setSent(''); setNeedsVerify(false);
    try {
      const r = await authClient.signIn.sendEmailCode(email.trim());
      if (r.error) {
        setErr(authErrorText(r.error));
        if (r.error.status === 429) resendWait.start(r.error.retryAfterSeconds ?? 60);
        if (r.error.code === 'BROWSER_BINDING_REQUIRED') resendWait.start(60);
        return;
      }
      setCode(''); resendWait.start(60);
      setSent('If this is an eligible Super Admin account with verified Gmail, a 6-digit code is on its way. It expires in 5 minutes and can be used once.');
    } catch (e) { setErr(authErrorText(e as Error)); } finally { setBusy(false); }
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setSent(''); setNeedsVerify(false);
    try {
      if (emailMethod) {
        if (verifyWait.remaining) return;
        const r = await authClient.signIn.verifyEmailCode(email.trim(), code);
        if (r.error) {
          setErr(authErrorText(r.error));
          if (r.error.code === 'EMAIL_LOGIN_RESTART') setCode('');
          if (r.error.status === 429) verifyWait.start(r.error.retryAfterSeconds ?? 60);
          return;
        }
        setCode(''); nav('/two-factor', { replace: true }); return;
      }
      const r = await authClient.signIn.email({ email: email.trim(), password });
      if (r.error) {
        setNeedsVerify(r.error.code === 'EMAIL_NOT_VERIFIED'); setErr(authErrorText(r.error));
        if (r.error.status === 429) passwordWait.start(r.error.retryAfterSeconds ?? 60);
        return;
      }
      setPassword('');
      const destination = '/admin';
      if ((r.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        nav('/two-factor', { replace: true }); return;
      }
      nav(destination, { replace: true });
    } catch (e) { setErr(authErrorText(e as Error)); } finally { setBusy(false); }
  };
  const resend = async () => {
    setErr('');
    const r = await authClient.sendVerificationEmail({ email: email.trim() });
    if (r.error) setErr(authErrorText(r.error)); else setSent('If the account exists, a new verification link is on its way.');
  };
  return (
    <AuthFrame title="Sign in to VYNOX LAYER" subtitle="Use your existing password, then your existing Google Authenticator." footer={<>New here? <A id="link-sign-up" href="/sign-up">Create an account</A></>}>
      <MailNotice status={status} failed={failed} />
      <div className="grid grid-cols-2 gap-2" aria-label="Sign-in method">
        <button type="button" data-testid="button-password-method" aria-pressed={!emailMethod} disabled={busy}
          className="rounded-md border px-3 py-2 text-sm font-medium"
          onClick={() => { setEmailMethod(false); setCode(''); setErr(''); setSent(''); setNeedsVerify(false); }}>Password</button>
        <button type="button" data-testid="button-email-method" aria-pressed={emailMethod} disabled={busy}
          className="rounded-md border px-3 py-2 text-sm font-medium"
          onClick={() => { setEmailMethod(true); setPassword(''); setErr(''); setSent(''); setNeedsVerify(false); }}>Email code (optional)</button>
      </div>
      <Form onSubmit={submit}>
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        {emailMethod ? <>
          <p className="text-sm text-muted-foreground">Super Admins only: use your verified Gmail instead of your password. Google Authenticator is still required before Admin access.</p>
          {supabaseDevelopmentAuth && <p className="text-sm text-muted-foreground">If this preview blocks secure cookies, <a className="font-medium underline" data-testid="link-direct-development-sign-in" href={`${import.meta.env.VITE_QXLAYER_DEVELOPMENT_SUPABASE_AUTH_URL}/sign-in`} target="_blank" rel="noopener noreferrer">open Development sign-in in a new tab</a> and request the code there. Keep that tab open for verification.</p>}
          <button type="button" data-testid="button-send-login-code" disabled={busy || !email || resendWait.remaining > 0} className="text-sm font-medium hover:underline" onClick={() => void sendCode()}>
            {resendWait.remaining ? `Send again in ${resendWait.remaining}s` : 'Send email code'}
          </button>
          <Field id="login-email-code" label="6-digit email verification code" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" maxLength={6} />
        </> : <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />}
        <ErrorLine>{err}</ErrorLine><SuccessLine>{sent}</SuccessLine>
        {needsVerify && !isMailUnavailable(null) && <button type="button" data-testid="button-resend-verification" onClick={() => void resend()} className="text-sm font-medium text-[var(--s-accent-ink,hsl(var(--primary)))] hover:underline">Resend verification email</button>}
        <Submit id="button-sign-in" busy={busy} disabled={!email || (emailMethod ? !/^[0-9]{6}$/.test(code) || verifyWait.remaining > 0 : !password || passwordWait.remaining > 0)}>
          {emailMethod ? verifyWait.remaining ? `Try again in ${verifyWait.remaining}s` : 'Verify email code' : passwordWait.remaining ? `Try again in ${passwordWait.remaining}s` : 'Sign in with password'}
        </Submit>
      </Form>
      <button type="button" data-testid="button-login-another-method" disabled={busy} className="block w-full text-center text-sm font-medium hover:underline"
        onClick={() => { setEmailMethod(!emailMethod); setPassword(''); setCode(''); setErr(''); setSent(''); setNeedsVerify(false); }}>
        {emailMethod ? 'Use existing password instead' : 'Use an email code instead (optional)'}
      </button>
      <p data-testid="text-existing-preserved" className="text-center text-sm text-muted-foreground">Migrated accounts keep their existing IDs and access. If your previous account has not been migrated, request an ownership review; do not create another Owner account.</p>
      <div className="text-center text-sm"><A id="link-forgot" href="/forgot-password">Forgot your password?</A></div>
    </AuthFrame>
  );
}
