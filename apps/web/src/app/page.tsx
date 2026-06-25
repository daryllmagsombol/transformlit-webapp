import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-surface to-surface-container-low p-6">
      <div className="max-w-md text-center space-y-8">
        <h1 className="font-display text-headline-h1 text-primary">
          Transformlit
        </h1>
        <p className="font-body text-body text-on-surface-variant text-balance">
          A community-driven platform for reading groups, book sharing, and literary engagement.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="w-full sm:w-auto py-3 px-8 bg-primary text-on-primary rounded-md font-display text-small font-bold text-center hover:bg-brand-orange-dark transition-colors active:scale-[0.98]"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto py-3 px-8 bg-surface-container-high text-on-surface-variant rounded-md font-display text-small font-bold text-center border border-outline-variant hover:bg-surface-container-higher transition-colors active:scale-[0.98]"
          >
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
