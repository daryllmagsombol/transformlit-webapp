'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../../store';
import type { GraphQLUser } from '@transformlit/shared';
import { useToast, TextInput, SpinnerIcon, PersonIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon, GoogleIcon, FacebookIcon, MicrosoftIcon } from '../../components/ui';
import { Footer } from '../../components/layout';
import { API_BASE } from '../../lib/constants';

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
/*  RegisterForm                                                      */
/* ------------------------------------------------------------------ */

export default function RegisterForm() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);
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

  /* ---------- Redirect if already authenticated ---------- */
  useEffect(() => {
    if (isHydrated && user) {
      router.replace('/feed');
    }
  }, [isHydrated, user, router]);

  /* ---------- Submit handler ---------- */

  const onSubmit = useCallback(
    async (values: RegisterFormValues) => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: values.fullName.trim(),
            email: values.email.trim(),
            password: values.password,
          }),
        });

        if (!res.ok) {
          let message = 'Registration failed. Please try again.';
          try {
            const body = (await res.json()) as { error?: string; message?: string };
            // Prefer the human-readable `message` over the generic `error` label;
            // fall back to `error` when `message` is absent.
            if (body?.message) message = body.message;
            else if (body?.error) message = body.error;
          } catch {
            // Non-JSON error body — keep the fallback message.
          }
          throw new Error(message);
        }

        const data = (await res.json()) as { accessToken: string; user: GraphQLUser };
        setAuth(data.user, data.accessToken);

        addToast('Account created! Welcome to Transformlit.', 'success');
        router.push('/feed');
      } catch (err: any) {
        const message = err?.message ?? 'Registration failed. Please try again.';
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
      window.location.href = `${API_BASE}/auth/${provider.toLowerCase()}`;
    },
    [],
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
          <div className="text-center mb-8">
            <h2 className="font-sans text-2xl font-bold text-ink mb-1">
              Create Account
            </h2>
            <p className="font-serif text-base text-ink-soft">
              Begin your literary journey with us today.
            </p>
          </div>

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
                  <SpinnerIcon />
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
