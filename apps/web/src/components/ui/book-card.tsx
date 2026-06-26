'use client';

import type { GraphQLBook } from '@transformlit/shared';

interface BookCardProps {
  book: GraphQLBook;
  onRead?: () => void;
  onBuy?: () => void;
}

export function BookCard({ book, onRead, onBuy }: BookCardProps) {
  const isFree = book.accessLevel === 'FREE';

  const priceLabel = isFree
    ? 'FREE'
    : book.price != null
      ? `${book.currency ?? '$'}${book.price}`
      : 'Premium';

  return (
    <div className="bg-paper-warm rounded-xl border border-outline-variant overflow-hidden shadow-sm hover:shadow-md transition-all group flex flex-col">
      {/* Cover */}
      <div className="aspect-[2/3] overflow-hidden relative bg-surface-container-high">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-6xl text-on-surface-variant">
              menu_book
            </span>
          </div>
        )}

        {/* Badge */}
        <span
          className={`absolute top-3 left-3 px-2 py-1 rounded font-micro text-[10px] uppercase tracking-tighter font-bold ${
            isFree
              ? 'bg-success text-white'
              : 'bg-ink-black text-ink-white'
          }`}
        >
          {isFree ? 'Community' : 'Premium'}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <span className="font-micro text-micro uppercase tracking-wider text-on-surface-variant mb-1">
          {isFree ? 'Community Library' : 'Premium Collection'}
        </span>
        <h3 className="font-display text-headline-h4 text-on-surface line-clamp-2 leading-snug mb-1">
          {book.title}
        </h3>
        {book.author && (
          <p className="font-body text-small text-on-surface-variant line-clamp-1 mb-3">
            {book.author}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3">
          <span className="font-display text-headline-h4 text-primary">{priceLabel}</span>
          {isFree ? (
            <button
              onClick={onRead}
              className="px-4 py-2 rounded-lg border-2 border-primary text-primary font-display text-small font-bold hover:bg-primary hover:text-on-primary transition-colors active:scale-95"
            >
              Read
            </button>
          ) : (
            <button
              onClick={onBuy}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary font-display text-small font-bold hover:bg-brand-orange-dark transition-colors active:scale-95"
            >
              Buy
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function BookCardSkeleton() {
  return (
    <div className="bg-paper-warm rounded-xl border border-outline-variant overflow-hidden animate-pulse flex flex-col">
      <div className="aspect-[2/3] bg-surface-container-high" />
      <div className="p-4 space-y-3">
        <div className="h-3 bg-surface-container-high rounded w-1/2" />
        <div className="h-5 bg-surface-container-high rounded w-3/4" />
        <div className="h-4 bg-surface-container-high rounded w-2/3" />
        <div className="flex justify-between items-center pt-2">
          <div className="h-5 bg-surface-container-high rounded w-16" />
          <div className="h-9 bg-surface-container-high rounded w-20" />
        </div>
      </div>
    </div>
  );
}
