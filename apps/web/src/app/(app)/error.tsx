'use client';

export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6">
      <div className="bg-surface-container-low border border-outline-variant rounded-xl max-w-md w-full text-center space-y-4 p-8 shadow-sm">
        <h1 className="font-display text-headline-h3 text-on-surface">Something went wrong</h1>
        <p className="font-body text-body text-on-surface-variant text-balance">
          An unexpected error occurred. Please try again.
        </p>
        {error.digest && (
          <p className="font-micro text-micro text-outline">Error ID: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="w-full py-3 bg-primary text-on-primary rounded-md font-display text-small font-bold hover:bg-brand-orange-dark transition-colors active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
