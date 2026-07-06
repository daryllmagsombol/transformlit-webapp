'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../lib/apollo-client';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { useToast, NotificationItem, LoadingSpinner } from '../../components/ui';

const NOTIFICATIONS_QUERY = gql`
  query AllNotifications($limit: Int!) {
    notifications(limit: $limit) {
      id
      type
      payload
      readAt
      createdAt
    }
  }
`;

const MARK_READ = gql`
  mutation MarkNotificationRead($notificationId: String!) {
    markNotificationRead(notificationId: $notificationId)
  }
`;

const MARK_ALL_READ = gql`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

interface Notification {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
}

function relativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString();
}

function getBody(n: Notification): string {
  switch (n.type) {
    case 'FRIEND_REQUEST': return 'sent you a friend request';
    case 'FRIEND_ACCEPTED': return 'accepted your friend request';
    case 'GROUP_INVITE': return 'invited you to join a group';
    case 'GROUP_UPDATE': return 'New discussion in your group';
    default: return 'You have a new notification';
  }
}

function groupByDate(notifications: Notification[]): Map<string, Notification[]> {
  const groups = new Map<string, Notification[]>();
  const now = new Date();

  for (const n of notifications) {
    const date = new Date(n.createdAt);
    let key: string;
    if (date.toDateString() === now.toDateString()) key = 'Today';
    else if (new Date(now.getTime() - 86400000).toDateString() === date.toDateString()) key = 'Yesterday';
    else if (now.getTime() - date.getTime() < 7 * 86400000) key = 'This Week';
    else key = 'Older';

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  return groups;
}

export default function NotificationsClient() {
  const { isReady } = useRequireAuth();
  const { addToast } = useToast();
  const router = useRouter();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await apolloClient.query({
        query: NOTIFICATIONS_QUERY,
        variables: { limit: 50 },
      });
      setNotifications(data.notifications ?? []);
    } catch {
      addToast('Failed to load notifications.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isReady) fetchNotifications();
  }, [isReady, fetchNotifications]);

  const handlePress = async (notification: Notification) => {
    try {
      await apolloClient.mutate({
        mutation: MARK_READ,
        variables: { notificationId: notification.id },
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      window.dispatchEvent(new CustomEvent('notifications-cleared'));
    } catch {
      // Silent fail
    }

    if (notification.type === 'FRIEND_REQUEST' || notification.type === 'FRIEND_ACCEPTED') {
      router.push('/friends');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apolloClient.mutate({ mutation: MARK_ALL_READ });
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      window.dispatchEvent(new CustomEvent('notifications-cleared'));
    } catch {
      addToast('Failed to mark all as read.', 'error');
    }
  };

  if (!isReady) return <LoadingSpinner />;

  const grouped = groupByDate(notifications);

  return (
    <div className="max-w-[800px] mx-auto py-8">
      {/* Header */}
      <div className="flex justify-between items-baseline mb-8 border-b border-outline-variant pb-4">
        <h1 className="font-headline-h1 text-on-surface">Notifications</h1>
        {notifications.some((n) => !n.readAt) && (
          <button
            onClick={handleMarkAllRead}
            className="text-info font-small font-medium hover:underline transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-container-high rounded-xl animate-pulse" />
          ))}
        </div>
      ) : notifications.length > 0 ? (
        <div className="space-y-10">
          {Array.from(grouped.entries()).map(([group, items]) => (
            <section key={group}>
              <h2 className="font-display text-headline-h4 text-on-surface-variant mb-4">
                {group}
              </h2>
              <div className="space-y-3">
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    type={n.type}
                    body={getBody(n)}
                    timestamp={relativeTime(n.createdAt)}
                    read={!!n.readAt}
                    onPress={() => handlePress(n)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="py-24 flex flex-col items-center text-center">
          <span className="material-symbols-outlined text-[120px] text-primary opacity-40 mb-4">
            notifications_off
          </span>
          <h3 className="font-headline-h3 text-on-surface mb-2">All caught up!</h3>
          <p className="font-body text-on-surface-variant max-w-xs">
            Your inbox is quiet. We&apos;ll let you know when something new happens.
          </p>
        </div>
      )}
    </div>
  );
}
