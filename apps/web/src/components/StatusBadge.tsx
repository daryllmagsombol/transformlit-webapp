type StatusBadgeProps = {
  label: string;
};

export function StatusBadge({ label }: StatusBadgeProps) {
  return (
    <span className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold text-ink-soft">
      {label}
    </span>
  );
}
