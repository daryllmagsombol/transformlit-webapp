type SkeletonCardProps = {
  lines?: number;
  className?: string;
};

export function SkeletonCard({ lines = 2, className = '' }: SkeletonCardProps) {
  return (
    <div
      className={`bg-surface border border-outline-variant rounded-lg p-6 flex gap-6 animate-pulse ${className}`}
    >
      <div className="w-16 h-16 rounded-lg bg-surface-container-high shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-5 bg-surface-container-high rounded w-3/4" />
        {lines > 1 && <div className="h-4 bg-surface-container-high rounded w-full" />}
        {lines > 2 && <div className="h-4 bg-surface-container-high rounded w-2/3" />}
      </div>
    </div>
  );
}
