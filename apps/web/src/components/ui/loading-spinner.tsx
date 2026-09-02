type LoadingSpinnerProps = {
  /** Show the "Loading…" label below the spinner. Default: true */
  showLabel?: boolean;
  /** Wrap in a min-h-screen flex centering container. Default: true */
  fullScreen?: boolean;
  /** Custom className for the outer wrapper */
  className?: string;
};

export function LoadingSpinner({
  showLabel = true,
  fullScreen = true,
  className = '',
}: LoadingSpinnerProps) {
  const wrapperClass = fullScreen
    ? `min-h-screen bg-surface flex items-center justify-center ${className}`
    : `flex items-center justify-center ${className}`;

  return (
    <div className={wrapperClass.trim()}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        {showLabel && <span className="text-on-surface-variant font-small">Loading…</span>}
      </div>
    </div>
  );
}
