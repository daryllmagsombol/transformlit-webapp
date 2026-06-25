import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-surface dark:bg-surface-dark p-6">
      <div className="bg-surface-container-low border border-outline-variant rounded-xl max-w-md w-full text-center space-y-4 p-8 shadow-sm">
        <h1 className="font-display text-headline-h3 text-on-surface">Page not found</h1>
        <p className="font-body text-body text-on-surface-variant text-balance">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="block w-full py-3 bg-primary text-on-primary rounded-md font-display text-small font-bold hover:bg-brand-orange-dark transition-colors active:scale-[0.98]"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
