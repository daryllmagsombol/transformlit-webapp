export default function LoadingPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-paper p-6">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <p className="text-sm text-ink-soft">Loading...</p>
      </div>
    </div>
  );
}
