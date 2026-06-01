type LoadingStateProps = {
  message?: string;
};

export function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper p-6 text-sm text-ink-soft">
      {message}
    </div>
  );
}
