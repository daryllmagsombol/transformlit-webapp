import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-ink bg-brand text-lg font-semibold text-ink">
            TL
          </div>
          <div>
            <p className="text-xl font-semibold text-ink">Transformlit</p>
            <p className="text-sm text-ink-soft">
              Turning Pages. Turning Hearts.
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <Link
            className="rounded-full border-2 border-ink px-5 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper"
            href="/login"
          >
            Login
          </Link>
          <Link
            className="rounded-full border-2 border-ink bg-brand px-5 py-2 text-sm font-semibold text-ink transition hover:bg-brand-dark"
            href="/register"
          >
            Register
          </Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-16 pt-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col gap-6">
          <span className="w-fit rounded-full border border-ink/20 bg-paper-warm px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-ink">
            Community Reading
          </span>
          <h1 className="text-4xl font-semibold leading-tight text-ink md:text-5xl">
            Build groups, share books, and keep the conversation alive.
          </h1>
          <p className="max-w-xl text-base leading-7 text-ink-soft">
            Transformlit brings readers together with announcements, groups, and
            books in one focused space. Start with your community and scale from
            there.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-full border-2 border-ink bg-brand px-6 py-3 text-sm font-semibold text-ink transition hover:bg-brand-dark"
              href="/register"
            >
              Create an account
            </Link>
            <Link
              className="rounded-full border-2 border-ink px-6 py-3 text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper"
              href="/login"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="rounded-3xl border border-ink/15 bg-paper-warm p-6 shadow-[0_10px_30px_rgba(17,17,17,0.12)]">
          <h2 className="text-lg font-semibold text-ink">What you get in v1</h2>
          <ul className="mt-4 space-y-3 text-sm text-ink-soft">
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand" />
              Announcements feed after login
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand" />
              Friends, groups, and book access
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand" />
              Polling chat ready for realtime later
            </li>
          </ul>
          <div className="mt-6 rounded-2xl border border-ink/10 bg-paper p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">
              Next Up
            </p>
            <p className="mt-2 text-sm text-ink">
              Invitations, moderation, and curated reading lists.
            </p>
          </div>
        </section>

        <div className="flex gap-3 md:hidden">
          <Link
            className="flex-1 rounded-full border-2 border-ink px-4 py-2 text-center text-sm font-semibold text-ink"
            href="/login"
          >
            Login
          </Link>
          <Link
            className="flex-1 rounded-full border-2 border-ink bg-brand px-4 py-2 text-center text-sm font-semibold text-ink"
            href="/register"
          >
            Register
          </Link>
        </div>
      </main>
    </div>
  );
}
