'use client';

import Link from 'next/link';
import { Reveal } from './motion-reveal';

const APP_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.transformlit.app';

const SPOTLIGHTS = [
  {
    icon: 'home_work',
    title: 'Tahanan Campus Community Group',
    description: 'A campus community where students walk the discipleship journey together.',
  },
  {
    icon: 'groups',
    title: 'Community Groups',
    description: 'Find a small group or start one near you.',
  },
  {
    icon: 'auto_stories',
    title: 'Books & Library',
    description: 'Read, buy, and download our publications.',
  },
];

export function CommunityGateway() {
  return (
    <section id="beyond-the-books" className="bg-surface-container-low">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <Reveal>
          <div className="max-w-2xl space-y-3">
            <h2 className="font-display text-headline-h2 text-ink-black">Beyond the Books</h2>
            <p className="font-body text-body text-on-surface-variant">
              The TransformLit Community Hub is where discipleship keeps going —
              reading groups, libraries, and friendships that build one another up.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            {SPOTLIGHTS.map((item) => (
              <article key={item.title} className="card space-y-4">
                <span
                  aria-hidden
                  className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary-container text-on-primary-container"
                >
                  <span className="material-symbols-outlined">{item.icon}</span>
                </span>
                <h3 className="font-display text-headline-h3 text-ink-black">{item.title}</h3>
                <p className="font-body text-body text-on-surface-variant">{item.description}</p>
              </article>
            ))}
          </div>

          <div className="mt-12 rounded-md bg-paper-warm text-ink-black border border-ink-black/10 p-8 lg:p-12 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="space-y-2">
              <h3 className="font-display text-headline-h2 text-ink-black">
                Join the TransformLit Community
              </h3>
              <p className="font-body text-body text-on-surface-variant max-w-xl">
                Sign up free and start reading, joining groups, and growing alongside
                transformed followers.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <Link href="/register" className="btn-primary whitespace-nowrap">
                Join the Community
              </Link>
              <Link
                href={APP_PLAY_URL}
                className="btn-ghost text-ink-black border border-ink-black/40 whitespace-nowrap"
              >
                Get the App
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}