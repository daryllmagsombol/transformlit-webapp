'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useParams, useRouter } from 'next/navigation';
import { apolloClient } from '../../../lib/apollo-client';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { useAuthStore } from '../../../store';
import { useToast, UserAvatar, BookCard, LoadingSpinner } from '../../../components/ui';
import type { GraphQLBook } from '@transformlit/shared';

const USER_PROFILE_QUERY = gql`
  query UserProfile($id: String!) {
    userProfile(id: $id) {
      user { id displayName avatarUrl bio role }
      friendCount groupCount bookCount
      bookProgress {
        book { id title author coverUrl }
        currentPage
      }
      groups { id name slug description category coverImageUrl memberCount }
    }
  }
`;

const SEND_REQUEST = gql`
  mutation SendFriendRequest($addresseeId: String!) {
    sendFriendRequest(addresseeId: $addresseeId) { id status }
  }
`;

interface ProfileData {
  userProfile: {
    user: { id: string; displayName: string; avatarUrl?: string | null; bio?: string; role: string };
    friendCount: number;
    groupCount: number;
    bookCount: number;
    bookProgress: Array<{ book: { id: string; title: string; author?: string; coverUrl?: string }; currentPage: number }>;
    groups: Array<{ id: string; name: string; slug: string; description: string; category?: string; coverImageUrl?: string; memberCount: number }>;
  };
}

export default function UserProfileClient() {
  const { isReady } = useRequireAuth();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { addToast } = useToast();
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  const [profile, setProfile] = useState<ProfileData['userProfile'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await apolloClient.query<ProfileData>({
        query: USER_PROFILE_QUERY,
        variables: { id: userId },
      });
      if (data) setProfile(data.userProfile);
    } catch {
      addToast('Failed to load profile.', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, addToast]);

  useEffect(() => {
    if (isReady) fetchProfile();
  }, [isReady, fetchProfile]);

  const handleAddFriend = async () => {
    setSending(true);
    try {
      await apolloClient.mutate({
        mutation: SEND_REQUEST,
        variables: { addresseeId: userId },
      });
      addToast('Friend request sent!', 'success');
    } catch {
      addToast('Failed to send friend request.', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isReady || loading) return <LoadingSpinner />;
  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="font-body text-on-surface-variant">User not found.</p>
        <button onClick={() => router.back()} className="mt-4 text-primary font-bold hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const { user } = profile;
  const isOwnProfile = user.id === currentUserId;

  const toBookCardBook = (bp: ProfileData['userProfile']['bookProgress'][number]): GraphQLBook => ({
    id: bp.book.id,
    title: bp.book.title,
    author: bp.book.author ?? null,
    coverUrl: bp.book.coverUrl ?? null,
    accessLevel: 'FREE',
    status: 'PUBLISHED',
    createdAt: '',
  });

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-10">
      <button
        onClick={() => router.back()}
        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
      >
        <span className="material-symbols-outlined text-on-surface">arrow_back</span>
      </button>

      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-8">
          <div className="w-24 h-24 md:w-[96px] md:h-[96px] rounded-full border-4 border-paper-warm overflow-hidden shadow-lg flex-shrink-0">
            <UserAvatar avatarUrl={user.avatarUrl} displayName={user.displayName} size="md" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-2">
              <h1 className="font-headline-h1 text-on-surface">{user.displayName}</h1>
              {user.role !== 'MEMBER' && (
                <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-widest self-center md:self-auto uppercase">
                  {user.role}
                </span>
              )}
            </div>
            {user.bio && (
              <p className="font-body italic text-on-surface-variant text-lg max-w-xl mb-6">
                {user.bio}
              </p>
            )}
            {!isOwnProfile && (
              <button
                onClick={handleAddFriend}
                disabled={sending}
                className="bg-brand-orange-dark text-on-primary font-headline-h4 px-6 h-11 rounded-md flex items-center gap-2 shadow-sm hover:translate-y-[-2px] transition-all active:scale-95 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">person_add</span>
                {sending ? 'Sending...' : 'Add Friend'}
              </button>
            )}
          </div>
        </div>
        <div className="mt-6 pt-6 border-t border-outline-variant flex justify-center md:justify-start gap-6 text-on-surface-variant">
          <span><strong className="text-primary">{profile.friendCount}</strong> Friends</span>
          <span className="text-outline-variant">·</span>
          <span><strong className="text-primary">{profile.groupCount}</strong> Groups</span>
          <span className="text-outline-variant">·</span>
          <span><strong className="text-primary">{profile.bookCount}</strong> Books</span>
        </div>
      </section>

      {profile.bookProgress.length > 0 && (
        <section>
          <h2 className="font-headline-h2 text-on-surface mb-6">Currently Reading</h2>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x">
            {profile.bookProgress.map((bp) => (
              <div key={bp.book.id} className="flex-shrink-0 w-[160px] snap-start">
                <BookCard book={toBookCardBook(bp)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {profile.groups.length > 0 && (
        <section>
          <h2 className="font-headline-h2 text-on-surface mb-6">Active Groups</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {profile.groups.map((g) => (
              <div
                key={g.id}
                onClick={() => router.push(`/groups/${g.slug}`)}
                className="p-4 bg-paper rounded-lg border border-outline-variant flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="w-14 h-14 rounded-lg bg-secondary-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-on-secondary-container">auto_stories</span>
                </div>
                <div className="overflow-hidden">
                  <h4 className="font-headline-h4 text-sm line-clamp-1">{g.name}</h4>
                  <p className="font-micro text-xs text-on-surface-variant">{g.memberCount} members</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
