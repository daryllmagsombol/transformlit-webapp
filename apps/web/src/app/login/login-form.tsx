'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../store';
import { useToast } from '../../components/ui';

/* ------------------------------------------------------------------ */
/*  Inline SVG icons matching Material Symbols style                  */
/* ------------------------------------------------------------------ */

function MailIcon({ className = 'text-outline' }: { className?: string }) {
  return (
    <span className={`material-icon absolute left-md top-1/2 -translate-y-1/2 ${className}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 4l-10 8L2 4" />
      </svg>
    </span>
  );
}

function LockIcon({ className = 'text-outline' }: { className?: string }) {
  return (
    <span className={`material-icon absolute left-md top-1/2 -translate-y-1/2 ${className}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
        <path d="M8 11V7a4 4 0 018 0v4" />
      </svg>
    </span>
  );
}

function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      <path d="M8 7h8M8 11h6" />
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
/*  Helper: paper-texture background SVG                              */
/* ------------------------------------------------------------------ */

const PAPER_TEXTURE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%23d8c3ae' fill-opacity='0.3' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E")`;

/* ------------------------------------------------------------------ */
/*  Field validation                                                  */
/* ------------------------------------------------------------------ */

interface FieldErrors {
  email?: string;
  password?: string;
}

function validate(email: string, password: string): FieldErrors {
  const errs: FieldErrors = {};
  if (!email.trim()) {
    errs.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errs.email = 'Please enter a valid email address';
  }
  if (!password) {
    errs.password = 'Password is required';
  } else if (password.length < 6) {
    errs.password = 'Password must be at least 6 characters';
  }
  return errs;
}

/* ------------------------------------------------------------------ */
/*  LoginForm component                                               */
/* ------------------------------------------------------------------ */

export default function LoginForm() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { addToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);

  /* ---------- Social login handlers ---------- */

  const handleGoogleLogin = () => {
    addToast('Google sign-in coming soon', 'info');
  };

  const handleFacebookLogin = () => {
    addToast('Facebook sign-in coming soon', 'info');
  };

  const handleMicrosoftLogin = () => {
    addToast('Microsoft sign-in coming soon', 'info');
  };

  /* ---------- Email/password submit ---------- */

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);

    const fieldErrors = validate(email, password);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setLoading(true);
    try {
      const [{ gql }, { apolloClient }] = await Promise.all([
        import('@apollo/client'),
        import('../../lib/apollo-client'),
      ]);

      const result = await apolloClient.mutate({
        mutation: gql`
          mutation Login($input: LoginInput!) {
            login(input: $input) {
              user { id email displayName photoUrl }
              accessToken
              refreshToken
            }
          }
        `,
        variables: { input: { email: email.trim(), password } },
      });

      const { user, accessToken, refreshToken } = result.data.login;
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
  };

  /* ---------- Render ---------- */

  return (
    <>
      {/* ======================== HEADER ======================== */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-paper/80 backdrop-blur-md border-b border-border/30">
        <div className="flex items-center justify-center h-[56px] px-base">
          <Link
            href="/"
            className="font-sans text-display text-brand tracking-tight hover:text-brand-dark transition-colors leading-none"
          >
            Transformlit
          </Link>
        </div>
      </header>

      {/* ======================== MAIN ======================== */}
      <main
        className="flex items-center justify-center min-h-dvh px-base pt-[72px] pb-xl"
        style={{ background: '#fff8f4' }}
      >
        {/* ---- Card ---- */}
        <div
          className="
            relative w-full max-w-[460px]
            bg-white rounded-[20px]
            p-[40px]
            border border-[#d8c3ae]/40
            overflow-hidden
          "
          style={{
            boxShadow: '0 8px 32px -4px rgba(34,26,18,0.08), 0 4px 12px -2px rgba(34,26,18,0.04)',
          }}
        >
          {/* Accent bar */}
          <div
            className="absolute top-0 left-0 w-full h-[6px]"
            style={{
              background: 'linear-gradient(90deg, #845400 0%, #D88710 50%, #F4A11C 100%)',
            }}
          />

          {/* ---------- Title ---------- */}
          <div className="text-center mb-[32px]">
            <h1 className="font-sans text-[32px] leading-[1.2] font-bold text-[#111111] tracking-tight mb-[8px]">
              Welcome Back
            </h1>
            <p className="font-serif text-[18px] leading-[1.5] text-[#524434] italic">
              The library awaits your return.
            </p>
          </div>

          {/* ---------- Form ---------- */}
          <form className="space-y-[20px]" onSubmit={handleSubmit} noValidate>
            {/* Email */}
            <div className="space-y-[8px]">
              <label
                htmlFor="email"
                className="block font-sans text-[14px] font-semibold text-[#111111] ml-[4px]"
              >
                Email Address
              </label>
              <div className="relative">
                <MailIcon />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="reader@transformlit.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (submitted) setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  className={`
                    w-full h-[44px] pl-[40px] pr-[16px]
                    bg-white border-2 rounded-[12px]
                    font-serif text-[16px] placeholder:text-[#857462]/60
                    outline-none transition-all duration-150
                    ${
                      errors.email && submitted
                        ? 'border-[#B9382D]'
                        : 'border-[#d8c3ae]/60 hover:border-[#d8c3ae]'
                    }
                    focus:border-[#F4A11C] focus:shadow-[0_0_0_2px_#F4A11C]
                  `}
                  aria-invalid={!!(errors.email && submitted)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                />
              </div>
              {errors.email && submitted && (
                <p id="email-error" className="text-[#B9382D] text-[12px] ml-[4px]" role="alert">
                  {errors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-[8px]">
              <div className="flex items-center justify-between px-[4px]">
                <label
                  htmlFor="password"
                  className="font-sans text-[14px] font-semibold text-[#111111]"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="font-sans text-[14px] font-semibold text-[#845400] hover:text-[#D88710] transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <LockIcon />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (submitted) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  className={`
                    w-full h-[44px] pl-[40px] pr-[16px]
                    bg-white border-2 rounded-[12px]
                    font-serif text-[16px] placeholder:text-[#857462]/60
                    outline-none transition-all duration-150
                    ${
                      errors.password && submitted
                        ? 'border-[#B9382D]'
                        : 'border-[#d8c3ae]/60 hover:border-[#d8c3ae]'
                    }
                    focus:border-[#F4A11C] focus:shadow-[0_0_0_2px_#F4A11C]
                  `}
                  aria-invalid={!!(errors.password && submitted)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                />
              </div>
              {errors.password && submitted && (
                <p
                  id="password-error"
                  className="text-[#B9382D] text-[12px] ml-[4px]"
                  role="alert"
                >
                  {errors.password}
                </p>
              )}
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-[8px] px-[4px]">
              <input
                id="remember"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="
                  w-4 h-4 rounded border-2 border-[#d8c3ae]
                  text-[#845400] accent-[#845400]
                  focus:ring-[#F4A11C] focus:ring-offset-0
                  cursor-pointer
                "
              />
              <label
                htmlFor="remember"
                className="font-sans text-[14px] text-[#524434] cursor-pointer select-none"
              >
                Remember me for 30 days
              </label>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="
                relative w-full h-[44px]
                bg-[#D88710] hover:bg-[#845400]
                text-white font-sans text-[18px] font-semibold
                rounded-[12px]
                flex items-center justify-center gap-[8px]
                transition-all duration-150
                active:translate-y-[2px]
                disabled:opacity-60 disabled:cursor-not-allowed disabled:active:translate-y-0
                shadow-[inset_0_-3px_0_#845400] active:shadow-none
                group
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
                  <span className="group-hover:translate-x-[2px] transition-transform">
                    <BookIcon />
                  </span>
                </>
              )}
            </button>
          </form>

          {/* ---------- Social divider ---------- */}
          <div className="relative my-[20px] text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#d8c3ae]/50" />
            </div>
            <span className="relative px-[16px] bg-white text-[#524434] font-sans text-[14px] tracking-wide uppercase">
              or continue with
            </span>
          </div>

          {/* ---------- Social buttons ---------- */}
          <div className="grid grid-cols-3 gap-[12px]">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="flex items-center justify-center h-[44px] border-2 border-[#d8c3ae]/60 rounded-[12px] hover:bg-[#fff8f4] hover:border-[#d8c3ae] transition-all group"
              title="Login with Google"
            >
              <span className="group-hover:scale-110 transition-transform">
                <GoogleIcon />
              </span>
            </button>

            <button
              type="button"
              onClick={handleFacebookLogin}
              className="flex items-center justify-center h-[44px] border-2 border-[#d8c3ae]/60 rounded-[12px] hover:bg-[#1877F2]/5 hover:border-[#1877F2]/30 transition-all group"
              title="Login with Facebook"
            >
              <span className="group-hover:scale-110 transition-transform">
                <FacebookIcon />
              </span>
            </button>

            <button
              type="button"
              onClick={handleMicrosoftLogin}
              className="flex items-center justify-center h-[44px] border-2 border-[#d8c3ae]/60 rounded-[12px] hover:bg-[#fff8f4] hover:border-[#d8c3ae] transition-all group"
              title="Login with Microsoft"
            >
              <span className="group-hover:scale-110 transition-transform">
                <MicrosoftIcon />
              </span>
            </button>
          </div>

          {/* ---------- Register link ---------- */}
          <p className="text-center mt-[20px] font-sans text-[14px] text-[#524434]">
            Don&apos;t have an account?{' '}
            <Link
              href="/register"
              className="font-semibold text-[#845400] hover:text-[#D88710] transition-colors"
            >
              Create one
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
