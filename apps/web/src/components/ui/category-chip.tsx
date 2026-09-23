'use client';

interface CategoryChipProps {
  readonly label: string;
  readonly icon: string;
  readonly active?: boolean;
  readonly onClick?: () => void;
}

export function CategoryChip({ label, icon, active = false, onClick }: CategoryChipProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-6 py-3 rounded-full font-display text-headline-h4 whitespace-nowrap active:scale-95 transition-all ${
        active
          ? 'bg-brand-orange-dark text-white'
          : 'bg-paper-warm text-on-surface-variant border border-outline-variant hover:bg-surface-container'
      }`}
    >
      <span className="material-symbols-outlined">{icon}</span>
      {label}
    </button>
  );
}
