import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-paper to-paper-warm p-6">
      <div className="max-w-md text-center space-y-8">
        <h1 className="text-display font-bold text-ink">
          Transformlit
        </h1>
        <p className="text-body text-ink-soft text-balance">
          A community-driven platform for reading groups, book sharing, and literary engagement.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/register" className="btn-primary text-center">
            Get Started
          </Link>
          <Link href="/login" className="btn-secondary text-center">
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
