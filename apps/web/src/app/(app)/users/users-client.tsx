'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import Link from 'next/link';
import type { GraphQLUser } from '@transformlit/shared';
import { apolloClient } from '../../../lib/apollo-client';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { useToast, UserAvatar, LoadingSpinner } from '../../../components/ui';

// ── GraphQL ─────────────────────────────────────────────────────────────────

const USERS_QUERY = gql`
  query Users {
    users {
      id
      displayName
      avatarUrl
      bio
      role
    }
  }
`;

// ── Users Directory Page ────────────────────────────────────────────────────

export default function UsersClient() {
  const { isReady } = useRequireAuth();
  const { addToast } = useToast();

  const [users, setUsers] = useState<GraphQLUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { data } = await apolloClient.query<{ users: GraphQLUser[] }>({
        query: USERS_QUERY,
      });
      setUsers(data?.users ?? []);
    } catch {
      setError(true);
      addToast('Failed to load users. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isReady) loadUsers();
  }, [isReady, loadUsers]);

  if (!isReady || loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-[1200px] mx-auto py-6 space-y-8">
      {/* Header */}
      <section>
        <p className="font-micro text-xs uppercase tracking-[0.2em] text-on-surface-variant mb-2">
          Community
        </p>
        <h1 className="font-display text-headline-h2 text-on-surface">Members</h1>
      </section>

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="material-symbols-outlined text-[80px] text-error opacity-40">error</span>
          <h2 className="font-display text-headline-h2 text-on-surface-variant mb-2">
            Something went wrong
          </h2>
          <p className="font-body max-w-sm text-on-surface-variant mb-6">
            Failed to load members. Please try again.
          </p>
          <button
            onClick={loadUsers}
            className="px-6 h-11 bg-primary text-on-primary rounded-lg font-display text-small font-bold hover:bg-brand-orange-dark transition-colors active:scale-[0.98]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!error && users.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="material-symbols-outlined text-[80px] text-primary opacity-40">group</span>
          <h2 className="font-display text-headline-h2 text-on-surface-variant mb-2">
            No members yet
          </h2>
          <p className="font-body max-w-sm text-on-surface-variant">
            The community is just getting started. Check back soon as readers join.
          </p>
        </div>
      )}

      {/* Directory grid */}
      {!error && users.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {users.map((user) => (
            <Link
              key={user.id}
              href={`/users/${user.id}`}
              className="group flex items-center gap-4 p-4 bg-surface border border-outline-variant rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="ring-4 ring-white rounded-full shadow-inner shrink-0">
                <UserAvatar
                  avatarUrl={user.avatarUrl}
                  displayName={user.displayName}
                  size="md"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-headline-h4 text-on-surface truncate">
                    {user.displayName}
                  </h3>
                  {user.role !== 'MEMBER' && (
                    <span className="font-micro text-[10px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                      {user.role}
                    </span>
                  )}
                </div>
                {user.bio ? (
                  <p className="font-small text-small text-on-surface-variant line-clamp-2">
                    {user.bio}
                  </p>
                ) : (
                  <p className="font-small text-small text-on-surface-variant/60 italic">
                    No bio yet
                  </p>
                )}
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
