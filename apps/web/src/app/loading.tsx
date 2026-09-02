export default function LoadingPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-surface dark:bg-surface-dark p-6">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="font-body text-small text-on-surface-variant">Loading...</p>
      </div>
    </div>
  );
}
