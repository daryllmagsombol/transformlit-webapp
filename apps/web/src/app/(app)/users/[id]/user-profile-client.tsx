'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useParams, useRouter } from 'next/navigation';
import { apolloClient } from '../../../../lib/apollo-client';
import { startDirectConversation } from '../../../../lib/chat-queries';
import { useRequireAuth } from '../../../../lib/hooks/use-require-auth';
import { useAuthStore } from '../../../../store';
import { useToast, UserAvatar, BookCard, LoadingSpinner } from '../../../../components/ui';
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
      mutualFriends { id displayName avatarUrl }
    }
  }
`;

const FRIENDSHIP_STATUS_QUERY = gql`
  query FriendshipStatus($otherUserId: String!) {
    friendshipStatus(otherUserId: $otherUserId) {
      id
      requesterId
      addresseeId
      status
    }
  }
`;

const ACCEPT_REQUEST = gql`
  mutation AcceptFriendRequest($friendshipId: String!) {
    acceptFriendRequest(friendshipId: $friendshipId) { id status }
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
    mutualFriends: Array<{ id: string; displayName: string; avatarUrl?: string | null }>;
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
  const [friendship, setFriendship] = useState<{ id: string; requesterId: string; addresseeId: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const [{ data }, { data: fsData }] = await Promise.all([
        apolloClient.query<ProfileData>({
          query: USER_PROFILE_QUERY,
          variables: { id: userId },
        }),
        apolloClient.query<{ friendshipStatus: typeof friendship }>({
          query: FRIENDSHIP_STATUS_QUERY,
          variables: { otherUserId: userId },
        }),
      ]);
      if (data) setProfile(data.userProfile);
      setFriendship(fsData?.friendshipStatus ?? null);
    } catch {
      addToast('Failed to load profile.', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId, addToast]);

  useEffect(() => {
    if (isReady) fetchProfile();
  }, [isReady, fetchProfile]);

  const handleAction = async () => {
    if (!friendship) return handleAddFriend();
    if (friendship.status === 'PENDING' && friendship.addresseeId === currentUserId) return handleAccept(friendship.id);
  };

  const handleAddFriend = async () => {
    setActionLoading(true);
    try {
      await apolloClient.mutate({
        mutation: gql`
          mutation SendFriendRequest($addresseeId: String!) {
            sendFriendRequest(addresseeId: $addresseeId) { id status }
          }
        `,
        variables: { addresseeId: userId },
      });
      addToast('Friend request sent!', 'success');
      fetchProfile();
    } catch {
      addToast('Failed to send friend request.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAccept = async (friendshipId: string) => {
    setActionLoading(true);
    try {
      await apolloClient.mutate({
        mutation: ACCEPT_REQUEST,
        variables: { friendshipId },
      });
      addToast('Friend request accepted!', 'success');
      fetchProfile();
    } catch {
      addToast('Failed to accept request.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMessage = async () => {
    if (!friendship || friendship.status !== 'ACCEPTED') return;
    setActionLoading(true);
    try {
      const conversationId = await startDirectConversation(userId);
      router.push(`/chat/${conversationId}`);
    } catch {
      addToast('You can only message your friends.', 'error');
    } finally {
      setActionLoading(false);
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

  // Derive button state
  let buttonLabel = 'Add Friend';
  let buttonDisabled = false;
  let buttonOnClick = handleAction;

  if (friendship) {
    if (friendship.status === 'ACCEPTED') {
      buttonLabel = 'Friends';
      buttonDisabled = true;
    } else if (friendship.status === 'PENDING') {
      if (friendship.requesterId === currentUserId) {
        buttonLabel = 'Request Sent';
        buttonDisabled = true;
      } else {
        buttonLabel = 'Accept Request';
        buttonDisabled = false;
      }
    }
  }

  const BOOK_STATUS_PILLS: { label: string; colorClass: string }[] = [
    { label: 'Reading', colorClass: 'bg-success text-white' },
    { label: 'Queued', colorClass: 'bg-accent-teal-dark text-white' },
    { label: 'Reprinted', colorClass: 'bg-brand-orange-dark text-white' },
  ];

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
    <div className="py-8 space-y-10">
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
              <h1 className="font-display font-headline-h1 text-on-surface">{user.displayName}</h1>
              {user.role !== 'MEMBER' && (
                <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-widest self-center md:self-auto uppercase">
                  {user.role}
                </span>
              )}
            </div>
            {user.bio && (
              <p className="font-body text-body italic text-on-surface-variant max-w-xl mb-6">
                {user.bio}
              </p>
            )}
            {!isOwnProfile && (
              <div className="flex items-center justify-center md:justify-start gap-3">
                <button
                  onClick={buttonOnClick}
                  disabled={buttonDisabled || actionLoading}
                  className={`font-display font-headline-h4 px-6 h-11 rounded-md flex items-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-50 ${
                    buttonDisabled
                      ? 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                      : 'bg-brand-orange-dark text-on-primary hover:translate-y-[-2px]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {friendship?.status === 'ACCEPTED' ? 'check' : 'person_add'}
                  </span>
                  {actionLoading ? 'Loading...' : buttonLabel}
                </button>
                {friendship?.status === 'ACCEPTED' && (
                  <button
                    onClick={() => void handleMessage()}
                    disabled={actionLoading}
                    className="font-display font-headline-h4 px-6 h-11 rounded-md border border-outline-variant text-on-surface flex items-center gap-2 shadow-sm transition-all active:scale-95 hover:bg-surface-container-high disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[20px]">chat_bubble</span>
                    {actionLoading ? 'Loading...' : 'Message'}
                  </button>
                )}
              </div>
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

      {!isOwnProfile && profile.mutualFriends.length > 0 && (
        <section>
          <h2 className="font-micro text-micro uppercase tracking-widest text-on-surface-variant mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-base">group</span>
            Mutual Friends
          </h2>
          <div className="flex gap-5 overflow-x-auto pb-2 -mx-4 px-4">
            {profile.mutualFriends.map((friend) => (
              <div key={friend.id} className="flex flex-col items-center gap-2 min-w-[64px]">
                <UserAvatar avatarUrl={friend.avatarUrl} displayName={friend.displayName} size="md" />
                <span className="font-micro text-[10px] text-on-surface-variant text-center line-clamp-1">
                  {friend.displayName}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {profile.bookProgress.length > 0 && (
        <section>
          <h2 className="font-display font-headline-h2 text-on-surface mb-6">Currently Reading</h2>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x">
            {profile.bookProgress.map((bp, index) => {
              const status = BOOK_STATUS_PILLS[index % BOOK_STATUS_PILLS.length];
              return (
                <div key={bp.book.id} className="flex-shrink-0 w-[160px] snap-start">
                  <BookCard
                    book={toBookCardBook(bp)}
                    statusPill={
                      <span
                        className={`inline-block rounded-full uppercase text-[10px] font-bold px-2 py-0.5 ${status.colorClass}`}
                      >
                        {status.label}
                      </span>
                    }
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {profile.groups.length > 0 && (
        <section>
          <h2 className="font-display font-headline-h2 text-on-surface mb-6">Active Groups</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {profile.groups.map((g, idx) => (
              <div
                key={g.id}
                onClick={() => router.push(`/groups/${g.slug}`)}
                className="p-4 bg-paper rounded-lg border border-outline-variant flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="w-14 h-14 rounded-lg bg-secondary-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-on-secondary-container">auto_stories</span>
                </div>
                <div className="overflow-hidden">
                  <h4 className="font-display font-headline-h4 line-clamp-1">{g.name}</h4>
                  <p className="font-micro text-xs text-on-surface-variant">
                    {g.memberCount} members · {idx < 2 ? 'Active now' : 'Active today'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
