type EmptyStateProps = {
  title: string;
  body: string;
};

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper p-6 text-sm text-ink-soft">
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="mt-2">{body}</p>
    </div>
  );
}
