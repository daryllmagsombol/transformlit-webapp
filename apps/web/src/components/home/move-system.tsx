'use client';

import Link from 'next/link';
import { motion, stagger, useReducedMotion, type Variants } from 'motion/react';
import { BOOKS } from './content';

export function MoveSystem() {
  const reduce = useReducedMotion();
  const hiddenInitial = reduce;

  const gridVariants = {
    hidden: {},
    visible: { transition: { when: 'beforeChildren' as const, delayChildren: stagger(0.1) } },
  };
  const cardVariants: Variants = hiddenInitial
    ? {
        hidden: { opacity: 0, y: 24 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
      }
    : {};

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

        <motion.div
          className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-12"
          initial={hiddenInitial ? 'hidden' : false}
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={gridVariants}
        >
          {BOOKS.map((book) => (
            <motion.article key={book.title} className="card space-y-4 flex flex-col" variants={cardVariants}>
              <img
                src={book.coverSrc}
                alt=""
                className="h-40 w-full object-cover rounded-md border-2 border-ink-black"
              />
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
            </motion.article>
          ))}
        </motion.div>

        <motion.div
          aria-hidden
          className="mt-10 h-1 rounded-full bg-primary-fixed-dim"
          initial={hiddenInitial ? { scaleX: 0 } : false}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ transformOrigin: 'left' }}
        />

        <p className="font-small text-small text-on-surface-variant mt-10 max-w-3xl">
          Complete resources included — leaders&apos; guide, presentations, and video
          supplements — for disciplers running online or face-to-face small groups.
        </p>
      </div>
    </section>
  );
}