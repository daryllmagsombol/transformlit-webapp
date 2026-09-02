'use client';

import { Reveal } from './motion-reveal';
import { ANNOUNCEMENTS } from './content';

export function Announcements() {
  return (
    <section id="announcements" className="mx-auto max-w-[1200px] px-6 py-20">
      <Reveal>
        <h2 className="font-display text-headline-h2 text-ink-black">Announcements</h2>
        <div className="grid md:grid-cols-2 gap-6 mt-10">
          {ANNOUNCEMENTS.map((item) => (
            <article key={item.title} className="card space-y-3">
              <p className="font-micro text-micro uppercase tracking-[0.1em] text-on-surface-variant">
                {item.date}
              </p>
              <h3 className="font-display text-headline-h4 text-ink-black">{item.title}</h3>
              <p className="font-body text-body text-on-surface-variant">{item.excerpt}</p>
            </article>
          ))}
        </div>
      </Reveal>
    </section>
  );
}