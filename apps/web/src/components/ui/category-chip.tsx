'use client';

interface CategoryChipProps {
  label: string;
  icon: string;
  active?: boolean;
  onClick?: () => void;
}

export function CategoryChip({ label, icon, active = false, onClick }: CategoryChipProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-6 py-3 rounded-full font-display text-headline-h4 whitespace-nowrap active:scale-95 transition-all ${
        active
          ? 'bg-secondary-container text-on-secondary-container'
          : 'bg-paper-warm text-on-surface-variant border border-outline-variant hover:bg-surface-container'
      }`}
    >
      <span className="material-symbols-outlined">{icon}</span>
      {label}
    </button>
  );
}
