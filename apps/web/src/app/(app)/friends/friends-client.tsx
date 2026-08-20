'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../../lib/apollo-client';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { useAuthStore } from '../../../store';
import {
  useToast,
  FriendCard,
  FriendRequestItem,
  SuggestedFriendCard,
  UserSearchInput,
  LoadingSpinner,
  Modal,
} from '../../../components/ui';
import { UserProfileSheet } from '../../../components/friends/user-profile-sheet';

const FRIENDS_QUERY = gql`
  query Friends {
    friends {
      id
      requesterId
      addresseeId
      requester { id displayName avatarUrl bio }
      addressee { id displayName avatarUrl bio }
      status
    }
  }
`;

const REQUESTS_QUERY = gql`
  query FriendRequests {
    friendRequests {
      id
      requester { id displayName avatarUrl bio }
      status
    }
  }
`;

const ACCEPT_REQUEST = gql`
  mutation AcceptFriendRequest($friendshipId: String!) {
    acceptFriendRequest(friendshipId: $friendshipId) {
      id
      status
    }
  }
`;

const REJECT_REQUEST = gql`
  mutation RejectFriendRequest($friendshipId: String!) {
    rejectFriendRequest(friendshipId: $friendshipId) {
      id
      status
    }
  }
`;

const SEND_REQUEST = gql`
  mutation SendFriendRequest($addresseeId: String!) {
    sendFriendRequest(addresseeId: $addresseeId) {
      id
      status
    }
  }
`;

const REMOVE_FRIEND = gql`
  mutation RemoveFriend($friendshipId: String!) {
    removeFriend(friendshipId: $friendshipId)
  }
`;

interface FriendData {
  id: string;
  requesterId: string;
  addresseeId: string;
  requester: { id: string; displayName: string; avatarUrl?: string | null; bio?: string };
  addressee: { id: string; displayName: string; avatarUrl?: string | null; bio?: string };
  status: string;
}

interface RequestData {
  id: string;
  requester: { id: string; displayName: string; avatarUrl?: string | null; bio?: string };
  status: string;
}

export default function FriendsClient() {
  const { isReady } = useRequireAuth();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { addToast } = useToast();
  const router = useRouter();

  const [friends, setFriends] = useState<FriendData[]>([]);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestsOpen, setRequestsOpen] = useState(true);
  const [profileSheetUserId, setProfileSheetUserId] = useState<string | null>(null);
  const [declineConfirmId, setDeclineConfirmId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [friendsResult, requestsResult] = await Promise.all([
        apolloClient.query<{ friends: FriendData[] }>({ query: FRIENDS_QUERY }),
        apolloClient.query<{ friendRequests: RequestData[] }>({ query: REQUESTS_QUERY }),
      ]);
      setFriends(friendsResult.data?.friends ?? []);
      setRequests(requestsResult.data?.friendRequests ?? []);
    } catch {
      addToast('Failed to load friends.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isReady) loadData();
  }, [isReady, loadData]);

  const handleAccept = async (friendshipId: string) => {
    try {
      await apolloClient.mutate({ mutation: ACCEPT_REQUEST, variables: { friendshipId } });
      addToast('Friend request accepted!', 'success');
      loadData();
    } catch {
      addToast('Failed to accept request.', 'error');
    }
  };

  const handleReject = async (friendshipId: string) => {
    try {
      await apolloClient.mutate({ mutation: REJECT_REQUEST, variables: { friendshipId } });
      addToast('Friend request declined.', 'info');
      setDeclineConfirmId(null);
      loadData();
    } catch {
      addToast('Failed to decline request.', 'error');
    }
  };

  const handleSendRequest = async (userId: string) => {
    try {
      await apolloClient.mutate({ mutation: SEND_REQUEST, variables: { addresseeId: userId } });
      addToast('Friend request sent!', 'success');
    } catch {
      addToast('Failed to send request.', 'error');
    }
  };

  const handleSelectUser = (userId: string) => {
    setProfileSheetUserId(userId);
  };

  if (!isReady) return <LoadingSpinner />;

  const getFriendInfo = (f: FriendData) => {
    if (f.requesterId === currentUserId) return f.addressee;
    return f.requester;
  };

  return (
    <div className="space-y-10">
      {/* Search */}
      <div className="sticky top-16 bg-background/80 backdrop-blur-md z-30 py-4 -mx-4 px-4 md:mx-0 md:px-0">
        <UserSearchInput onSelectUser={handleSelectUser} currentUserId={currentUserId ?? ''} />
      </div>

      {/* Friend Requests */}
      {requests.length > 0 && (
        <section>
          <button
            onClick={() => setRequestsOpen(!requestsOpen)}
            className="flex items-center justify-between w-full mb-4 group"
          >
            <h3 className="font-display text-headline-h2 text-on-surface">
              Friend Requests ({requests.length})
            </h3>
            <span
              className="material-symbols-outlined text-on-surface-variant transition-transform duration-300"
              style={{ transform: requestsOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
            >
              expand_less
            </span>
          </button>
          {requestsOpen && (
            <div className="space-y-3">
              {requests.map((req) => (
                <FriendRequestItem
                  key={req.id}
                  name={req.requester.displayName}
                  bio={req.requester.bio}
                  avatarUrl={req.requester.avatarUrl}
                  onAccept={() => handleAccept(req.id)}
                  onDecline={() => setDeclineConfirmId(req.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Suggested Friends (placeholder — real suggestions come later via group overlap) */}
      <section>
        <h3 className="font-display text-headline-h2 text-on-surface mb-4">Suggested Friends</h3>
        {loading ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="min-w-[200px] h-48 bg-surface-container-high rounded-xl animate-pulse flex-shrink-0" />
            ))}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 snap-x">
            <SuggestedFriendCard name="Leo T." tag="Classic Literature Fan" onAdd={() => addToast('Suggestions coming soon!', 'info')} />
            <SuggestedFriendCard name="Emma K." tag="Sci-Fi Enthusiast" onAdd={() => addToast('Suggestions coming soon!', 'info')} />
            <SuggestedFriendCard name="Oliver K." tag="Poetry Lover" onAdd={() => addToast('Suggestions coming soon!', 'info')} />
          </div>
        )}
      </section>

      {/* Friends List */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-headline-h2 text-on-surface">
            Your Friends ({friends.length})
          </h3>
          <button
            onClick={() => addToast('Manage coming soon.', 'info')}
            className="text-info font-small font-medium hover:underline transition-colors"
          >
            Manage
          </button>
        </div>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 bg-surface-container-high rounded-xl animate-pulse" />
            ))}
          </div>
        ) : friends.length > 0 ? (
          <div className="space-y-3">
            {friends.map((f, index) => {
              const friend = getFriendInfo(f);
              return (
                <FriendCard
                  key={f.id}
                  name={friend.displayName}
                  bio={friend.bio}
                  avatarUrl={friend.avatarUrl}
                  onPress={() => setProfileSheetUserId(friend.id)}
                  statusBadge={
                    index < 2 ? (
                      <span className="inline-flex items-center bg-success text-white text-micro rounded-full px-2 py-0.5 font-small">
                        ONLINE
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="material-symbols-outlined text-[80px] text-primary opacity-40">person_search</span>
            <h3 className="font-display text-headline-h2 text-on-surface-variant mb-2">Finding your circle?</h3>
            <p className="font-body max-w-sm text-on-surface-variant mb-8">
              Your friends list is empty. Search for fellow readers to connect!
            </p>
          </div>
        )}
      </section>

      {/* User Profile Sheet */}
      {profileSheetUserId && (
        <UserProfileSheet
          userId={profileSheetUserId}
          open={!!profileSheetUserId}
          onClose={() => setProfileSheetUserId(null)}
          currentUserId={currentUserId ?? ''}
        />
      )}
      {/* Decline Confirmation */}
      <Modal open={!!declineConfirmId} onClose={() => setDeclineConfirmId(null)} title="Decline Request">
        <p className="font-body text-body text-on-surface mb-6">
          Are you sure you want to decline this friend request?
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setDeclineConfirmId(null)}
            className="px-4 py-2 bg-surface-container-highest text-on-surface-variant rounded-lg font-small font-bold hover:bg-outline-variant/20 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => declineConfirmId && handleReject(declineConfirmId)}
            className="px-4 py-2 bg-error text-on-error rounded-lg font-small font-bold hover:opacity-90 transition-all"
          >
            Decline
          </button>
        </div>
      </Modal>
    </div>
  );
}
