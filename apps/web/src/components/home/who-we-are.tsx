import { PILLARS } from './content';

export function WhoWeAre() {
  return (
    <section id="who-we-are" className="mx-auto max-w-[1200px] px-6 py-20">
      <div className="max-w-2xl space-y-4">
        <h2 className="font-display text-headline-h2 text-ink-black">Who We Are</h2>
        <p className="font-body text-body text-on-surface-variant">
          Transform Lit is a non-stock, non-profit organization reaching and
          preparing the next generation through servant-leadership trainings,
          moral-recovery-centered literature, and mental-health empowerment
          through life coaching and community groups.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mt-10">
        {PILLARS.map((pillar) => (
          <article key={pillar.title} className="card space-y-4">
            <span
              aria-hidden
              className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary-container text-on-primary-container"
            >
              <span className="material-symbols-outlined">{pillar.icon}</span>
            </span>
            <h3 className="font-display text-headline-h3 text-ink-black">{pillar.title}</h3>
            <p className="font-body text-body text-on-surface-variant">{pillar.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}