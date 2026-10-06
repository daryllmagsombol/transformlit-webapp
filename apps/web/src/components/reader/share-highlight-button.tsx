'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLGroup } from '@transformlit/shared';
import { useToast } from '../ui';
import { apolloClient } from '../../lib/apollo-client';
import {
  fetchMyGroups,
  SHARE_HIGHLIGHT_TO_GROUP_MUTATION,
} from '../../lib/group-features';

interface ShareHighlightButtonProps {
  /** The server-side Highlight id. Absent until the local record has synced. */
  readonly highlightServerId: string | null | undefined;
  readonly highlightLabel: string;
}

/**
 * Reader-side "Share to group" control. Only rendered/enabled once the local
 * highlight has a server id (`serverEntityId`), because a group share points at
 * the server `Highlight` row — an unsynced local highlight has nothing to share.
 */
export function ShareHighlightButton({ highlightServerId, highlightLabel }: ShareHighlightButtonProps) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GraphQLGroup[]>([]);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchMyGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [open]);

  const share = useCallback(
    async (groupId: string) => {
      if (!highlightServerId) return;
      setSharing(true);
      try {
        await apolloClient.mutate({
          mutation: SHARE_HIGHLIGHT_TO_GROUP_MUTATION,
          variables: { input: { groupId, highlightId: highlightServerId } },
        });
        addToast('Shared to group.', 'success');
        setOpen(false);
      } catch {
        addToast('Failed to share highlight.', 'error');
      } finally {
        setSharing(false);
      }
    },
    [highlightServerId, addToast],
  );

  if (!highlightServerId) {
    return (
      <span
        className="font-small text-small text-on-surface-variant opacity-60"
        title="Available once this highlight has synced"
      >
        Share pending sync
      </span>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={`Share highlight for ${highlightLabel}`}
        className="font-small text-small font-semibold text-primary underline"
      >
        Share to group
      </button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-outline-variant bg-surface p-1 shadow-lg">
          {groups.length === 0 ? (
            <p className="px-3 py-2 font-small text-small text-on-surface-variant">
              No groups to share to.
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => share(group.id)}
                    disabled={sharing}
                    className="w-full rounded px-3 py-2 text-left font-small text-small text-on-surface hover:bg-surface-container-high disabled:opacity-60"
                  >
                    {group.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
