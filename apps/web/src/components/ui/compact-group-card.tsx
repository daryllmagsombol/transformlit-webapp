'use client';

interface CompactGroupCardProps {
  name: string;
  description?: string | null;
  icon: string;
  iconBg: string;
  iconColor?: string;
  onClick?: () => void;
}

export function CompactGroupCard({
  name,
  description,
  icon,
  iconBg,
  onClick,
}: CompactGroupCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isActivationKey = e.key === 'Enter' || e.key === ' ';
    if (isActivationKey) {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      className="bg-surface-container-low p-5 rounded-2xl border border-outline-variant flex items-center gap-4 hover:bg-surface-container transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div
        className={`w-16 h-16 rounded-xl flex-shrink-0 flex items-center justify-center ${iconBg}`}
      >
        <span className="material-symbols-outlined text-3xl">{icon}</span>
      </div>
      <div>
        <h4 className="font-display text-headline-h4 text-on-surface">{name}</h4>
        {description && (
          <p className="font-small text-small text-on-surface-variant">{description}</p>
        )}
      </div>
    </div>
  );
}
