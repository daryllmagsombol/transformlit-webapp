'use client';

export default function LoginPage() {
  const doLogin = () => {
    // Dynamically load Apollo at runtime
    import('../../lib/apollo-client').then(async ({ apolloClient }) => {
      const { gql } = await import('@apollo/client');
      const { useAuthStore } = await import('../../store');
      // Login flow triggers from user interaction, not build
    });
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-b from-paper to-paper-warm p-6">
      <div className="card max-w-md w-full space-y-6">
        <h1 className="text-h3 font-bold text-center">Welcome back</h1>
        <p className="text-center text-ink-soft">Login page — API connection required.</p>
      </div>
    </div>
  );
}
