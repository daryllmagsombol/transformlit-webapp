import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Footer — shared across login / register / public pages            */
/* ------------------------------------------------------------------ */

export function Footer() {
  return (
    <footer className="w-full py-8 border-t border-border bg-paper mt-auto relative z-10">
      <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row justify-between items-center gap-3 px-6">
        {/* Left: brand + copyright */}
        <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4">
          <span className="font-sans text-lg font-bold text-brand tracking-tight">
            Transformlit
          </span>
          <span className="text-sm text-ink-soft">
            &copy; 2024 Transformlit. All rights reserved.
          </span>
        </div>

        {/* Right: nav links */}
        <nav className="flex items-center gap-3 text-sm text-ink-soft" aria-label="Legal">
          <Link
            href="/privacy"
            className="hover:text-brand transition-colors"
          >
            Privacy Policy
          </Link>
          <span aria-hidden="true" className="text-ink-soft/30 select-none">&middot;</span>
          <Link
            href="/terms"
            className="hover:text-brand transition-colors"
          >
            Terms of Service
          </Link>
          <span aria-hidden="true" className="text-ink-soft/30 select-none">&middot;</span>
          <Link
            href="/contact"
            className="hover:text-brand transition-colors"
          >
            Contact Support
          </Link>
        </nav>
      </div>
    </footer>
  );
}
