'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-paper p-6">
      <div className="card max-w-md w-full text-center space-y-4">
        <h1 className="text-h2 font-bold text-ink">Something went wrong</h1>
        <p className="text-body text-ink-soft text-balance">
          An unexpected error occurred. Please try again.
        </p>
        {error.digest && (
          <p className="text-micro text-ink-soft">Error ID: {error.digest}</p>
        )}
        <button onClick={reset} className="btn-primary text-center w-full justify-center">
          Try again
        </button>
      </div>
    </div>
  );
}
