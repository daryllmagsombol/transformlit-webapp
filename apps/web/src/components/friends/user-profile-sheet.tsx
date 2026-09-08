'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { apolloClient } from '../../lib/apollo-client';
import { useRouter } from 'next/navigation';
import { startDirectConversation } from '../../lib/chat-queries';
import { useToast, UserAvatar, Modal } from '../ui';

const USER_PROFILE_QUERY = gql`
  query UserProfile($id: String!) {
    userProfile(id: $id) {
      user {
        id
        displayName
        avatarUrl
        bio
        role
      }
      friendCount
      groupCount
      bookCount
      bookProgress {
        book {
          title
        }
        currentPage
      }
      groups {
        name
      }
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

const SEND_FRIEND_REQUEST = gql`
  mutation SendFriendRequest($addresseeId: String!) {
    sendFriendRequest(addresseeId: $addresseeId) {
      id
      status
    }
  }
`;

interface UserProfileData {
  userProfile: {
    user: { id: string; displayName: string; avatarUrl?: string | null; bio?: string; role: string };
    friendCount: number;
    groupCount: number;
    bookCount: number;
    bookProgress: Array<{ book: { title: string }; currentPage: number }>;
    groups: Array<{ name: string }>;
  };
}

interface ButtonState {
  buttonLabel: string;
  buttonDisabled: boolean;
  buttonVariant: 'primary' | 'secondary' | 'disabled';
}

interface UserProfileSheetProps {
  readonly userId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly currentUserId: string;
}

function deriveButtonState(
  friendship: { id: string; requesterId: string; addresseeId: string; status: string } | null,
  currentUserId: string,
): ButtonState {
  let buttonLabel = 'Add Friend';
  let buttonDisabled = false;
  let buttonVariant: 'primary' | 'secondary' | 'disabled' = 'primary';

  if (friendship) {
    if (friendship.status === 'ACCEPTED') {
      buttonLabel = 'Friends';
      buttonDisabled = true;
      buttonVariant = 'disabled';
    } else if (friendship.status === 'PENDING') {
      if (friendship.requesterId === currentUserId) {
        buttonLabel = 'Request Sent';
        buttonDisabled = true;
        buttonVariant = 'disabled';
      } else {
        buttonLabel = 'Accept Request';
      }
    }
  }

  return { buttonLabel, buttonDisabled, buttonVariant };
}

export function UserProfileSheet({ userId, open, onClose, currentUserId }: UserProfileSheetProps) {
  const [profile, setProfile] = useState<UserProfileData['userProfile'] | null>(null);
  const [friendship, setFriendship] = useState<{ id: string; requesterId: string; addresseeId: string; status: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const { addToast } = useToast();
  const router = useRouter();

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [{ data }, { data: fsData }] = await Promise.all([
        apolloClient.query<UserProfileData>({
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
    if (open && userId) fetchData();
  }, [open, userId, fetchData]);

  const handleAction = async () => {
    if (!friendship) return handleAddFriend();
    if (friendship.status === 'PENDING' && friendship.addresseeId === currentUserId) return handleAccept(friendship.id);
  };

  const handleAddFriend = async () => {
    setActionLoading(true);
    try {
      await apolloClient.mutate({
        mutation: SEND_FRIEND_REQUEST,
        variables: { addresseeId: userId },
      });
      addToast('Friend request sent!', 'success');
      fetchData(); // refresh to show "Request Sent"
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
        mutation: gql`
          mutation AcceptFriendRequest($friendshipId: String!) {
            acceptFriendRequest(friendshipId: $friendshipId) { id status }
          }
        `,
        variables: { friendshipId },
      });
      addToast('Friend request accepted!', 'success');
      fetchData();
    } catch {
      addToast('Failed to accept request.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMessage = async () => {
    if (friendship?.status !== 'ACCEPTED') return;
    setActionLoading(true);
    try {
      const conversationId = await startDirectConversation(userId);
      onClose();
      router.push(`/chat/${conversationId}`);
    } catch {
      addToast('You can only message your friends.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const isOwnProfile = userId === currentUserId;
  const user = profile?.user;

  const { buttonLabel, buttonDisabled, buttonVariant } = deriveButtonState(friendship, currentUserId);

  function getButtonClassName(): string {
    if (buttonVariant === 'primary') return 'bg-brand-orange-dark text-white hover:brightness-110';
    if (buttonVariant === 'disabled') return 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed';
    return 'bg-white text-brand-orange-dark border-2 border-brand-orange-dark';
  }

  function getButtonIcon(): string {
    return friendship?.status === 'ACCEPTED' ? 'check' : 'person_add';
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col items-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 bg-surface-container-lowest/60 hover:bg-surface-container-lowest/80 p-1 rounded-full text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        {loading ? (
          <div className="w-full space-y-4 py-8">
            <div className="w-[72px] h-[72px] rounded-full bg-surface-container-high animate-pulse mx-auto" />
            <div className="h-6 bg-surface-container-high rounded w-1/3 mx-auto animate-pulse" />
            <div className="h-4 bg-surface-container-high rounded w-2/3 mx-auto animate-pulse" />
          </div>
        ) : user ? (
          <>
            <div className="w-[72px] h-[72px] rounded-full border-4 border-paper bg-surface overflow-hidden shadow-md mt-4">
              <UserAvatar avatarUrl={user.avatarUrl} displayName={user.displayName} size="md" />
            </div>
            <h3 className="mt-4 font-display text-headline-h2 text-on-surface">{user.displayName}</h3>
            {user.bio && (
              <p className="font-small text-small text-on-surface-variant mt-2 text-center line-clamp-2">
                {user.bio}
              </p>
            )}
            {user.role && user.role !== 'MEMBER' && (
              <span className="mt-2 px-2 py-0.5 bg-primary-container text-on-primary-container text-[10px] font-bold rounded-full uppercase tracking-wide">
                {user.role}
              </span>
            )}

            <div className="grid grid-cols-3 w-full gap-2 mt-6 mb-4 border-y border-outline-variant/30 py-4">
              <div className="text-center">
                <p className="font-display text-headline-h4 text-primary">{profile.friendCount}</p>
                <p className="font-micro text-[10px] uppercase text-on-surface-variant">Friends</p>
              </div>
              <div className="text-center border-x border-outline-variant/30">
                <p className="font-display text-headline-h4 text-primary">{profile.groupCount}</p>
                <p className="font-micro text-[10px] uppercase text-on-surface-variant">Groups</p>
              </div>
              <div className="text-center">
                <p className="font-display text-headline-h4 text-primary">{profile.bookCount}</p>
                <p className="font-micro text-[10px] uppercase text-on-surface-variant">Books</p>
              </div>
            </div>

            {profile.bookProgress.length > 0 && (
              <div className="w-full bg-surface-container-low p-4 rounded-lg mb-4">
                <div className="flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined text-brand-orange-dark text-sm">auto_stories</span>
                  <span className="font-micro text-[11px] uppercase font-bold text-brand-orange-dark">Currently reading</span>
                </div>
                <p className="font-body text-small italic text-on-surface leading-tight">
                  &ldquo;{profile.bookProgress[0].book.title}&rdquo;
                </p>
              </div>
            )}

            <div className="w-full flex flex-col gap-3">
              {!isOwnProfile && (
                <button
                  onClick={handleAction}
                  disabled={buttonDisabled || actionLoading}
                  className={`w-full py-3 rounded-lg font-bold shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50 ${getButtonClassName()}`}
                >
                  <span className="material-symbols-outlined">
                    {getButtonIcon()}
                  </span>
                  {actionLoading ? 'Loading...' : buttonLabel}
                </button>
              )}
              {friendship?.status === 'ACCEPTED' && (
                <button
                  onClick={() => void handleMessage()}
                  disabled={actionLoading}
                  className="w-full py-3 rounded-lg font-bold shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all border border-outline-variant text-on-surface hover:bg-surface-container-high disabled:opacity-50"
                >
                  <span className="material-symbols-outlined">chat_bubble</span>
                  {actionLoading ? 'Loading...' : 'Message'}
                </button>
              )}
              <button
                onClick={() => { onClose(); router.push(`/users/${userId}`); }}
                className="w-full text-center py-2 text-primary font-bold text-small hover:underline"
              >
                View Full Profile
              </button>
            </div>
          </>
        ) : (
          <p className="py-8 text-on-surface-variant">User not found.</p>
        )}
      </div>
    </Modal>
  );
}
