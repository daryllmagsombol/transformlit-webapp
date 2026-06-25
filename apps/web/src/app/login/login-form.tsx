'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../../store';
import { useToast, TextInput } from '../../components/ui';
import { Footer } from '../../components/layout';

/* ------------------------------------------------------------------ */
/*  Zod schema                                                        */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  rememberMe: z.boolean().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                  */
/* ------------------------------------------------------------------ */

function MailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4l-10 8L2 4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M14.12 14.12a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function AutoStoriesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 010-5H20" />
      <path d="M8 7h6" />
      <path d="M8 11h3" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 23 23">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" rx="1" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" rx="1" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" rx="1" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" rx="1" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  LoginForm                                                         */
/* ------------------------------------------------------------------ */

/** Derive REST API base URL by stripping /graphql suffix */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005/graphql').replace(
  /\/graphql$/,
  '',
);

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  const { addToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [oauthHandled, setOauthHandled] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  /* ---------- Google OAuth callback handler ---------- */
  /* When the backend redirects back to /login?token=...&refresh=...
     after a successful Google sign-in, parse those params, store the
     tokens, fetch the current user via the `me` query, then navigate   */
  useEffect(() => {
    if (oauthHandled || token) return; // already authenticated or already processed

    const urlToken = searchParams.get('token');
    const urlRefresh = searchParams.get('refresh');

    if (!urlToken || !urlRefresh) return;

    setOauthHandled(true);

    (async () => {
      try {
        // Temporarily store the access token so the authLink middleware
        // picks it up for the `me` query below.
        localStorage.setItem('accessToken', urlToken);
        localStorage.setItem('refreshToken', urlRefresh);

        const [{ gql }, { apolloClient }] = await Promise.all([
          import('@apollo/client'),
          import('../../lib/apollo-client'),
        ]);

        // Fetch user profile using the freshly stored access token
        const { data } = await apolloClient.query({
          query: gql`
            query Me { me { id email displayName photoUrl } }
          `,
        });

        setAuth(data.me, urlToken);
        addToast('Welcome back!', 'success');
        router.push('/feed');
      } catch {
        // If the `me` query fails (e.g. expired token), clear tokens
        // and let the user log in manually.
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        addToast('Google sign-in failed. Please try again.', 'error');
      }
    })();
  }, [searchParams, token, oauthHandled, router, setAuth, addToast]);

  /* ---------- Submit handler ---------- */

  const onSubmit = useCallback(
    async (values: LoginFormValues) => {
      setLoading(true);
      try {
        const [{ gql }, { apolloClient }] = await Promise.all([
          import('@apollo/client'),
          import('../../lib/apollo-client'),
        ]);

        const result = await apolloClient.mutate({
          mutation: gql`
            mutation LoginLocal($input: LoginLocalInput!) {
              loginLocal(input: $input) {
                user { id email displayName photoUrl }
                accessToken
                refreshToken
              }
            }
          `,
          variables: { input: { email: values.email.trim(), password: values.password } },
        });

        const { user, accessToken, refreshToken } = result.data.loginLocal;
        setAuth(user, accessToken);
        if (refreshToken) localStorage.setItem('refreshToken', refreshToken);

        addToast('Welcome back!', 'success');
        router.push('/feed');
      } catch (err: any) {
        const message =
          err?.graphQLErrors?.[0]?.message ??
          err?.networkError?.result?.errors?.[0]?.message ??
          err?.message ??
          'Invalid email or password';
        addToast(message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [router, setAuth, addToast],
  );

  /* ---------- Social login handlers ---------- */

  const handleGoogleLogin = useCallback(() => {
    window.location.href = `${API_BASE}/auth/google`;
  }, []);

  const handleSocialLogin = useCallback(
    (provider: string) => {
      addToast(`${provider} sign-in coming soon`, 'info');
    },
    [addToast],
  );

  /* ---------- Render ---------- */

  return (
    <div className="min-h-dvh flex flex-col bg-paper">
      {/* ======================== HEADER ======================== */}
      <header className="fixed top-0 inset-x-0 z-50 bg-paper/80 backdrop-blur-md">
        <div className="flex items-center justify-center h-14 px-4">
          <span className="font-sans text-2xl sm:text-3xl text-brand tracking-tight font-bold">
            Transformlit
          </span>
        </div>
      </header>

      {/* ======================== MAIN ======================== */}
      <main className="flex-1 flex items-center justify-center px-4 pt-20 pb-8">
        {/* ---- Card ---- */}
        <div className="relative w-full max-w-[440px] bg-surface rounded-xl shadow-soft border border-ink-soft/10 p-8 overflow-hidden">
          {/* Accent bar */}
          <div
            className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand to-brand-dark"
            aria-hidden="true"
          />

          {/* ---------- Title ---------- */}
          <h1 className="font-sans text-3xl sm:text-4xl font-bold text-ink tracking-tight mb-1">
            Welcome Back
          </h1>
          <p className="font-serif text-base sm:text-lg text-ink-soft italic mb-8">
            The library awaits your return.
          </p>

          {/* ---------- Form ---------- */}
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* Email */}
            <TextInput
              id="email"
              type="email"
              label="Email Address"
              placeholder="reader@transformlit.com"
              autoComplete="email"
              icon={<MailIcon />}
              error={errors.email?.message}
              {...register('email')}
            />

            {/* Password */}
            <div>
              {/* Password label row */}
              <div className="flex items-center justify-between ml-1 mb-2">
                <label
                  htmlFor="password"
                  className="font-sans text-sm font-semibold text-ink"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="font-sans text-sm font-semibold text-brand-dark hover:text-brand transition-colors underline decoration-ink-soft/30 underline-offset-4"
                >
                  Forgot?
                </Link>
              </div>

              <TextInput
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                autoComplete="current-password"
                icon={<LockIcon />}
                error={errors.password?.message}
                rightElement={
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="text-ink-soft/60 hover:text-ink-soft transition-colors p-1 -m-1"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                }
                {...register('password')}
              />
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2 px-1">
              <input
                id="remember"
                type="checkbox"
                className="
                  w-4 h-4 rounded border border-border
                  accent-brand-dark
                  focus:ring-brand focus:ring-offset-0
                  cursor-pointer
                "
                {...register('rememberMe')}
              />
              <label
                htmlFor="remember"
                className="text-sm text-ink-soft cursor-pointer select-none"
              >
                Remember me for 30 days
              </label>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="
                w-full h-11
                bg-brand-dark hover:bg-brand
                text-white font-sans text-lg font-semibold
                rounded-lg
                border-b-4 border-brand
                flex items-center justify-center gap-2
                shadow-sm
                transition-all duration-150
                active:translate-y-1 active:border-b-0
                disabled:opacity-60 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:border-b-4
                mt-4
              "
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Logging in…
                </span>
              ) : (
                <>
                  <span>Log In</span>
                  <span className="group-hover:translate-x-0.5 transition-transform">
                    <AutoStoriesIcon />
                  </span>
                </>
              )}
            </button>
          </form>

          {/* ---------- Divider ---------- */}
          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <span className="relative px-4 bg-surface text-sm text-ink-soft">
              or continue with
            </span>
          </div>

          {/* ---------- Social buttons ---------- */}
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="flex items-center justify-center h-11 border border-border rounded-lg hover:bg-paper hover:border-ink-soft/20 transition-all group"
              title="Login with Google"
            >
              <span className="group-hover:scale-110 transition-transform">
                <GoogleIcon />
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSocialLogin('Microsoft')}
              className="flex items-center justify-center h-11 border border-border rounded-lg hover:bg-paper hover:border-ink-soft/20 transition-all group"
              title="Login with Microsoft"
            >
              <span className="group-hover:scale-110 transition-transform">
                <MicrosoftIcon />
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSocialLogin('Facebook')}
              className="flex items-center justify-center h-11 border border-border rounded-lg hover:bg-paper hover:border-ink-soft/20 transition-all group"
              title="Login with Facebook"
            >
              <span className="group-hover:scale-110 transition-transform">
                <FacebookIcon />
              </span>
            </button>
          </div>
        </div>
      </main>

      {/* ======================== FOOTER ======================== */}
      <Footer />
    </div>
  );
}
