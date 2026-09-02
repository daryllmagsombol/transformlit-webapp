'use client';

interface ReadingProgressCardProps {
  coverUrl?: string | null;
  title: string;
  author?: string | null;
  currentPage: number;
  totalPages: number;
  onContinue?: () => void;
}

export function ReadingProgressCard({
  coverUrl,
  title,
  author,
  currentPage,
  totalPages,
  onContinue,
}: ReadingProgressCardProps) {
  const percent = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

  return (
    <div className="min-w-[280px] md:min-w-[320px] bg-surface-container-low rounded-xl border border-outline-variant shadow-sm p-4 flex flex-col gap-4">
      <div className="flex gap-4">
        {/* Cover */}
        <div className="w-20 h-[120px] md:w-24 md:h-[140px] rounded-lg overflow-hidden shrink-0 bg-surface-container-high">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant">
                menu_book
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col justify-between min-w-0 flex-1">
          <div>
            <h3 className="font-display text-headline-h4 text-on-surface line-clamp-2 leading-snug">
              {title}
            </h3>
            {author && (
              <p className="font-body text-small text-on-surface-variant mt-1 line-clamp-1">
                {author}
              </p>
            )}
          </div>
          <div>
            <span className="font-display text-headline-h3 text-primary">{percent}%</span>
            <p className="font-micro text-micro text-on-surface-variant mt-0.5">
              {currentPage} / {totalPages} pages
            </p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
        <div
          className="bg-brand-orange-dark h-full rounded-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* CTA */}
      <button
        onClick={onContinue}
        className="w-full py-2.5 bg-primary text-on-primary rounded-lg font-display text-small font-bold hover:bg-brand-orange-dark transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-[18px]">auto_stories</span>
        Continue Reading
      </button>
    </div>
  );
}
