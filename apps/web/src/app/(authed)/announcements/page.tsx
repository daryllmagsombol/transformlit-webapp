"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAnnouncements } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";

function buildMeta(item: {
  status: string;
  publishedAt: string | null;
  expiresAt: string | null;
}) {
  if (item.status === "draft") {
    return "Draft";
  }

  if (item.expiresAt) {
    const label = formatShortDate(item.expiresAt);
    return label ? `Expires ${label}` : "Expires soon";
  }

  const label = formatShortDate(item.publishedAt ?? null);
  return label ? `Published ${label}` : "Published";
}

export default function AnnouncementsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["announcements"],
    queryFn: fetchAnnouncements,
  });

  const errorMessage =
    error instanceof Error ? error.message : "Failed to load announcements";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink/10 bg-paper-warm p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">
          Announcements Feed
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">
          Keep your members informed
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Tenant admins can publish announcements to everyone after login.
        </p>
      </div>

      {isLoading ? <LoadingState message="Loading announcements..." /> : null}
      {isError ? <ErrorState message={errorMessage} /> : null}
      {!isLoading && !isError && data?.length === 0 ? (
        <EmptyState
          title="No announcements yet"
          body="Create an announcement to keep everyone informed."
        />
      ) : null}

      <div className="grid gap-4">
        {data?.map((item) => (
          <article
            key={item.id}
            className="rounded-2xl border border-ink/10 bg-paper p-5 shadow-[0_2px_12px_rgba(17,17,17,0.08)]"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">{item.title}</h2>
              <StatusBadge label={buildMeta(item)} />
            </div>
            <p className="mt-3 text-sm text-ink-soft">{item.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
