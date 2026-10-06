'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLGroupHighlight } from '@transformlit/shared';
import { useAuthStore } from '../../store';
import { useToast } from '../ui';
import { LoadingSpinner } from '../ui';
import {
  fetchGroupHighlights,
  UNSHARE_HIGHLIGHT_MUTATION,
} from '../../lib/group-features';
import { apolloClient } from '../../lib/apollo-client';
import { timeAgo } from '../../lib/time-ago';

const PAGE_SIZE = 25;

interface GroupHighlightsProps {
  readonly groupId: string;
  readonly canModerate: boolean;
}

/** One shared-highlight card: book, page, quote, note, sharer, actions. */
function HighlightCard({
  share,
  canUnshare,
  onUnshare,
  unsharing,
}: {
  readonly share: GraphQLGroupHighlight;
  readonly canUnshare: boolean;
  readonly onUnshare: (share: GraphQLGroupHighlight) => void;
  readonly unsharing: boolean;
}) {
  const initial = share.sharedBy.displayName?.[0]?.toUpperCase() ?? '?';
  return (
    <li className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
      <div className="mb-2 flex items-center gap-3">
        {share.sharedBy.avatarUrl ? (
          <img
            src={share.sharedBy.avatarUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-on-primary-container font-small font-semibold">
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <p className="font-small text-small font-semibold text-on-surface">
            {share.sharedBy.displayName}
          </p>
          <p className="font-micro text-micro text-on-surface-variant">
            {share.highlight.bookTitle} · page {share.highlight.page}
          </p>
        </div>
        <span className="ml-auto font-micro text-micro text-on-surface-variant">
          {timeAgo(share.createdAt)}
        </span>
      </div>
      <blockquote className="border-l-2 border-primary pl-3 font-body text-body text-on-surface">
        {share.highlight.text}
      </blockquote>
      {share.highlight.note ? (
        <p className="mt-2 font-small text-small text-on-surface-variant">{share.highlight.note}</p>
      ) : null}
      {canUnshare ? (
        <button
          type="button"
          onClick={() => onUnshare(share)}
          disabled={unsharing}
          aria-label={`Unshare highlight from page ${share.highlight.page}`}
          className="mt-3 font-small text-small font-semibold text-on-surface-variant underline disabled:opacity-50"
        >
          Unshare
        </button>
      ) : null}
    </li>
  );
}

export function GroupHighlights({ groupId, canModerate }: GroupHighlightsProps) {
  const { addToast } = useToast();
  const currentUser = useAuthStore((s) => s.user);
  const [shares, setShares] = useState<GraphQLGroupHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [unsharing, setUnsharing] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const list = await fetchGroupHighlights(groupId, 0, PAGE_SIZE);
      setShares(list);
      setHasMore(list.length === PAGE_SIZE);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = await fetchGroupHighlights(groupId, shares.length, PAGE_SIZE);
      setShares((prev) => [...prev, ...next]);
      setHasMore(next.length === PAGE_SIZE);
    } catch {
      addToast('Failed to load more highlights.', 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [groupId, shares.length, addToast]);

  const handleUnshare = useCallback(
    async (share: GraphQLGroupHighlight) => {
      setUnsharing(share.id);
      try {
        await apolloClient.mutate({
          mutation: UNSHARE_HIGHLIGHT_MUTATION,
          variables: { shareId: share.id },
        });
        setShares((prev) => prev.filter((row) => row.id !== share.id));
      } catch {
        addToast('Failed to unshare highlight.', 'error');
      } finally {
        setUnsharing(null);
      }
    },
    [addToast],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-8 text-center">
        <p className="font-body text-body text-on-surface-variant">
          Shared highlights are unavailable right now.
        </p>
      </div>
    );
  }

  if (shares.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2" aria-hidden="true">
          format_quote
        </span>
        <p className="font-body text-body text-on-surface-variant">No shared highlights yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-col gap-3" data-testid="group-highlights">
        {shares.map((share) => (
          <HighlightCard
            key={share.id}
            share={share}
            canUnshare={canModerate || share.sharedBy.id === currentUser?.id}
            onUnshare={handleUnshare}
            unsharing={unsharing === share.id}
          />
        ))}
      </ul>
      {hasMore ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full rounded-lg border border-outline-variant py-2 font-small text-small font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
