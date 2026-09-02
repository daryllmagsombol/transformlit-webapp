'use client';

import { useRouter } from 'next/navigation';

interface FeaturedGroupCardProps {
  name: string;
  slug?: string;
  description?: string | null;
  coverImageUrl?: string | null;
  memberCount: number;
  onJoin?: () => void;
  onDetails?: () => void;
}

export function FeaturedGroupCard({
  name,
  slug,
  description,
  coverImageUrl,
  memberCount,
  onJoin,
  onDetails,
}: FeaturedGroupCardProps) {
  const router = useRouter();
  return (
    <div className="md:col-span-8 bg-paper rounded-2xl p-6 md:p-8 flex flex-col md:flex-row gap-8 items-center border border-outline-variant relative overflow-hidden group">
      {/* Image */}
      <div className="w-full md:w-1/2 aspect-video rounded-xl overflow-hidden relative">
        {coverImageUrl ? (
          <img className="w-full h-full object-cover" src={coverImageUrl} alt={name} />
        ) : (
          <div className="w-full h-full bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-6xl text-on-primary-container">star</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-4">
          <span className="bg-brand-orange-dark text-on-primary font-micro text-micro uppercase tracking-tighter px-2 py-1 rounded">
            Editor&apos;s Choice
          </span>
        </div>
      </div>

      {/* Content */}
        <div className="w-full md:w-1/2">
          <h3 className="font-display text-display-mobile text-on-surface mb-2">{name}</h3>
        {description && (
          <p className="font-body text-body text-on-surface-variant mb-6">{description}</p>
        )}
        <div className="flex items-center gap-4">
          <button
            onClick={onJoin}
            className="px-8 py-3 bg-primary text-on-primary rounded-lg font-display text-headline-h4 border-2 border-[var(--color-primary,#845400)] active:scale-95 transition-transform hover:bg-brand-orange-dark"
          >
            Join Group
          </button>
          {(slug || onDetails) && (
            <button
              onClick={() => {
                if (slug) {
                  router.push(`/groups/${slug}`);
                } else if (onDetails) {
                  onDetails();
                }
              }}
              className="px-6 py-3 border border-primary text-primary rounded-lg font-display text-headline-h4 hover:bg-primary hover:text-on-primary transition-colors active:scale-95"
            >
              Details
            </button>
          )}
          <span className="font-small text-small text-on-surface-variant">
            {memberCount.toLocaleString()} Active Today
          </span>
        </div>
      </div>
    </div>
  );
}
