'use client';

import { GROUP_CATEGORIES } from '../../lib/constants';

interface GroupCardProps {
  name: string;
  slug?: string;
  description?: string | null;
  coverImageUrl?: string | null;
  memberCount: number;
  category?: string | null;
  featured?: boolean;
}

export function GroupCard({
  name,
  description,
  coverImageUrl,
  memberCount,
  category,
}: GroupCardProps) {
  return (
    <div className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant overflow-hidden flex flex-col group hover:shadow-lg transition-all duration-300">
      {/* Cover image */}
      <div className="h-32 overflow-hidden relative">
        {coverImageUrl ? (
          <img
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            src={coverImageUrl}
            alt={name}
          />
        ) : (
          <div className="w-full h-full bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-5xl text-on-primary-container">
              diversity_3
            </span>
          </div>
        )}
        <span className="absolute bottom-3 left-3 bg-ink-black/80 text-white text-[10px] uppercase px-2 py-0.5 rounded font-micro tracking-tighter">
          {GROUP_CATEGORIES.find((c) => c.key === category)?.label ?? 'Reading Circle'}
        </span>
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-display text-headline-h3 text-on-surface mb-2">{name}</h3>

        <div className="flex items-center gap-2 text-on-surface-variant mb-4">
          <span className="material-symbols-outlined text-sm">group</span>
          <span className="font-small text-small">
            {memberCount.toLocaleString()} Member{memberCount !== 1 ? 's' : ''}
          </span>
        </div>

        {description && (
          <p className="font-body text-body text-on-surface-variant line-clamp-2 mb-6 flex-1">
            {description}
          </p>
        )}

        <button className="w-full py-2 bg-primary text-on-primary rounded-lg font-display text-headline-h4 border-2 border-[var(--color-primary,#845400)] hover:bg-brand-orange-dark hover:border-brand-orange-dark transition-colors active:scale-[0.98]">
          Open Circle
        </button>
      </div>
    </div>
  );
}
