'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../../store';
import { useToast, TextInput } from '../../components/ui';
import { Footer } from '../../components/layout';

/** Derive REST API base URL by stripping /graphql suffix */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005/graphql').replace(
  /\/graphql$/,
  '',
);

/* ------------------------------------------------------------------ */
/*  Zod schema                                                        */
/* ------------------------------------------------------------------ */

const registerSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                  */
/* ------------------------------------------------------------------ */

function PersonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

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
/*  RegisterForm                                                      */
/* ------------------------------------------------------------------ */

export default function RegisterForm() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { addToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  /* ---------- Submit handler ---------- */

  const onSubmit = useCallback(
    async (values: RegisterFormValues) => {
      setLoading(true);
      try {
        const [{ gql }, { apolloClient }] = await Promise.all([
          import('@apollo/client'),
          import('../../lib/apollo-client'),
        ]);

        const result = await apolloClient.mutate({
          mutation: gql`
            mutation RegisterLocal($input: RegisterLocalInput!) {
              registerLocal(input: $input) {
                user { id email displayName photoUrl }
                accessToken
                refreshToken
              }
            }
          `,
          variables: {
            input: {
              displayName: values.fullName.trim(),
              email: values.email.trim(),
              password: values.password,
            },
          },
        });

        const { user, accessToken, refreshToken } = result.data.registerLocal;
        setAuth(user, accessToken);
        if (refreshToken) localStorage.setItem('refreshToken', refreshToken);

        addToast('Account created! Welcome to Transformlit.', 'success');
        router.push('/feed');
      } catch (err: any) {
        const message =
          err?.graphQLErrors?.[0]?.message ??
          err?.networkError?.result?.errors?.[0]?.message ??
          err?.message ??
          'Registration failed. Please try again.';
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
      addToast(`${provider} registration coming soon`, 'info');
    },
    [addToast],
  );

  /* ---------- Render ---------- */

  return (
    <div className="min-h-dvh flex flex-col bg-paper relative overflow-hidden">
      {/* Decorative blobs */}
      <div
        className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-brand/10 blur-[120px] pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-accent/15 blur-[120px] pointer-events-none"
        aria-hidden="true"
      />

      {/* ======================== MAIN ======================== */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 relative z-10">
        {/* ---- Brand header above card ---- */}
        <div className="text-center mb-8">
          <h1 className="font-sans text-2xl sm:text-3xl text-brand tracking-tight font-bold mb-1">
            Transformlit
          </h1>
          <p className="text-sm text-ink-soft italic">
            Where every word finds its purpose.
          </p>
        </div>

        {/* ---- Card ---- */}
        <div className="w-full max-w-[440px] bg-paper rounded-xl shadow-soft border border-border p-8">
          {/* ---------- Title ---------- */}
          <h2 className="font-sans text-2xl font-bold text-ink mb-1">
            Create Account
          </h2>
          <p className="font-serif text-base text-ink-soft mb-8">
            Begin your literary journey with us today.
          </p>

          {/* ---------- Form ---------- */}
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* Full Name */}
            <TextInput
              id="fullName"
              type="text"
              label="Full Name"
              placeholder="Arthur Conan Doyle"
              autoComplete="name"
              icon={<PersonIcon />}
              error={errors.fullName?.message}
              {...register('fullName')}
            />

            {/* Email */}
            <TextInput
              id="email"
              type="email"
              label="Email Address"
              placeholder="scholar@transformlit.com"
              autoComplete="email"
              icon={<MailIcon />}
              error={errors.email?.message}
              {...register('email')}
            />

            {/* Password */}
            <TextInput
              id="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="new-password"
              icon={<LockIcon />}
              hint="Must be at least 8 characters long."
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

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="
                w-full h-11
                bg-brand-dark hover:bg-brand
                text-white font-sans text-lg font-semibold
                rounded-lg
                shadow-sm hover:shadow-md
                border-2 border-brand/20
                flex items-center justify-center gap-2
                transition-all duration-150
                active:scale-[0.98]
                disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                mt-2
              "
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating account…
                </span>
              ) : (
                'Sign Up'
              )}
            </button>
          </form>

          {/* ---------- Divider ---------- */}
          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <span className="relative px-4 bg-paper text-xs text-ink-soft uppercase tracking-widest">
              Or register with
            </span>
          </div>

          {/* ---------- Social buttons ---------- */}
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="flex items-center justify-center h-11 border border-border rounded-lg hover:bg-surface hover:border-ink-soft/20 transition-all group"
              title="Register with Google"
            >
              <span className="group-hover:scale-110 transition-transform">
                <GoogleIcon />
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSocialLogin('Microsoft')}
              className="flex items-center justify-center h-11 border border-border rounded-lg hover:bg-surface hover:border-ink-soft/20 transition-all group"
              title="Register with Microsoft"
            >
              <span className="group-hover:scale-110 transition-transform">
                <MicrosoftIcon />
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSocialLogin('Facebook')}
              className="flex items-center justify-center h-11 border border-border rounded-lg hover:bg-surface hover:border-ink-soft/20 transition-all group"
              title="Register with Facebook"
            >
              <span className="group-hover:scale-110 transition-transform">
                <FacebookIcon />
              </span>
            </button>
          </div>

          {/* ---------- Terms footnote ---------- */}
          <p className="mt-5 text-center text-xs text-ink-soft leading-relaxed">
            By clicking Sign Up, you agree to Transformlit&rsquo;s{' '}
            <Link
              href="/terms"
              className="underline hover:text-brand transition-colors"
            >
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link
              href="/privacy"
              className="underline hover:text-brand transition-colors"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {/* ---------- Secondary link below card ---------- */}
        <p className="mt-6 text-sm text-ink-soft">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-semibold text-brand-dark hover:text-brand transition-colors"
          >
            Log In
          </Link>
        </p>
      </main>

      {/* ======================== FOOTER ======================== */}
      <Footer />
    </div>
  );
}
