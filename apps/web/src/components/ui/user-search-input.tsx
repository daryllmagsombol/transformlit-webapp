'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { gql } from '@apollo/client';
import { apolloClient } from '../../lib/apollo-client';
import { UserAvatar } from './user-avatar';

const SEARCH_USERS_QUERY = gql`
  query SearchUsers($query: String!) {
    searchUsers(query: $query) {
      id
      displayName
      avatarUrl
      bio
    }
  }
`;

interface SearchUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string;
}

interface UserSearchInputProps {
  onSelectUser: (userId: string) => void;
  currentUserId: string;
}

export function UserSearchInput({ onSelectUser, currentUserId }: UserSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await apolloClient.query({
        query: SEARCH_USERS_QUERY,
        variables: { query: q.trim() },
      });
      const filtered = (data.searchUsers ?? []).filter((u: SearchUser) => u.id !== currentUserId);
      setResults(filtered);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
          search
        </span>
        <input
          type="text"
          placeholder="Search users..."
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full pl-12 pr-4 py-3 bg-surface-container-lowest border-outline border rounded-xl focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all font-body"
        />
      </div>

      {open && (
        <div className="absolute top-full mt-2 w-full bg-surface border border-outline-variant rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto">
          {loading && (
            <div className="p-4 text-center text-on-surface-variant font-small">Searching...</div>
          )}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <div className="p-4 text-center text-on-surface-variant font-body-mobile">
              No users found matching &ldquo;{query}&rdquo;
            </div>
          )}
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => {
                onSelectUser(user.id);
                setOpen(false);
                setQuery('');
              }}
              className="w-full flex items-center gap-3 p-3 hover:bg-surface-container transition-colors text-left"
            >
              <UserAvatar avatarUrl={user.avatarUrl} displayName={user.displayName} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="font-headline-h4 text-on-surface text-sm truncate">{user.displayName}</p>
                {user.bio && (
                  <p className="font-micro text-on-surface-variant truncate">{user.bio}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
