import Link from 'next/link';
import { BOOKS } from './content';

export function MoveSystem() {
  return (
    <section id="move-system" className="bg-surface-container-low">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-2xl space-y-3">
          <p className="font-micro text-micro uppercase tracking-[0.15em] text-brand-orange-dark">
            A 2-year journey of transformation
          </p>
          <h2 className="font-display text-headline-h2 text-ink-black">
            The MOVE Discipleship System
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
          {BOOKS.map((book) => (
            <article key={book.title} className="card space-y-4 flex flex-col">
              <div className={`h-40 rounded-md ${book.coverClass} border-2 border-ink-black flex items-center justify-center`}>
                <span className="font-display text-headline-h3 text-ink-black">{book.title}</span>
              </div>
              <div className="space-y-2">
                <p className="font-micro text-micro uppercase tracking-[0.1em] text-brand-orange-dark">
                  Book {book.step}
                </p>
                <h3 className="font-display text-headline-h3 text-ink-black">{book.title}</h3>
                <p className="font-small text-small text-secondary">{book.phase}</p>
                <p className="font-body text-body text-on-surface-variant">{book.description}</p>
                <Link
                  href={book.shopeeUrl}
                  className="inline-block mt-2 px-4 py-2 rounded-sm bg-brand text-ink-black font-small text-small font-semibold border-2 border-ink-black hover:bg-brand-orange-dark transition-colors"
                >
                  Buy on Shopee
                </Link>
              </div>
            </article>
          ))}
        </div>

        <p className="font-small text-small text-on-surface-variant mt-10 max-w-3xl">
          Complete resources included — leaders&apos; guide, presentations, and video
          supplements — for disciplers running online or face-to-face small groups.
        </p>
      </div>
    </section>
  );
}