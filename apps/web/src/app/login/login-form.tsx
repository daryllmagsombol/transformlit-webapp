'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../../store';
import { useToast, TextInput, SpinnerIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon, AutoStoriesIcon, GoogleIcon, FacebookIcon, MicrosoftIcon } from '../../components/ui';
import { Footer } from '../../components/layout';
import { API_BASE } from '../../lib/constants';

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
/*  LoginForm                                                         */
/* ------------------------------------------------------------------ */

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
            query Me { me { id email displayName avatarUrl } }
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
                user { id email displayName avatarUrl }
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
          <div className="text-center mb-8">
            <h1 className="font-sans text-3xl sm:text-4xl font-bold text-ink tracking-tight mb-1">
              Welcome Back
            </h1>
            <p className="font-serif text-base sm:text-lg text-ink-soft italic">
              The library awaits your return.
            </p>
          </div>

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
                  <SpinnerIcon />
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

          {/* ---------- Register link ---------- */}
          <p className="mt-6 text-sm text-ink-soft text-center">
            New to the collection?{' '}
            <Link
              href="/register"
              className="font-semibold text-brand-dark hover:text-brand transition-colors"
            >
              Register here.
            </Link>
          </p>
        </div>
      </main>

      {/* ======================== FOOTER ======================== */}
      <Footer />
    </div>
  );
}
