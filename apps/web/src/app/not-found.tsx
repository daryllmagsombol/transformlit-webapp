import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-paper p-6">
      <div className="card max-w-md w-full text-center space-y-4">
        <h1 className="text-h2 font-bold text-ink">Page not found</h1>
        <p className="text-body text-ink-soft text-balance">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link href="/" className="btn-primary text-center inline-block w-full">
          Go home
        </Link>
      </div>
    </div>
  );
}
