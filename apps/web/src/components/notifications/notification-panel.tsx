'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../lib/apollo-client';
import { NotificationItem } from '../ui/notification-item';
import { useToast } from '../ui/toast';

const NOTIFICATIONS_QUERY = gql`
  query Notifications($limit: Int!) {
    notifications(limit: $limit) {
      id
      type
      payload
      readAt
      createdAt
    }
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

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

function getNotificationBody(notification: Notification): string {
  switch (notification.type) {
    case 'FRIEND_REQUEST':
      return 'sent you a friend request';
    case 'FRIEND_ACCEPTED':
      return 'accepted your friend request';
    case 'GROUP_INVITE':
      return 'invited you to join a group';
    case 'GROUP_UPDATE':
      return 'New discussion in your group';
    default:
      return 'You have a new notification';
  }
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

export function NotificationPanel({ open, onClose, userId }: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();
  const router = useRouter();

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apolloClient.query({
        query: NOTIFICATIONS_QUERY,
        variables: { limit: 5 },
      });
      setNotifications((data as { notifications: Notification[] }).notifications ?? []);
    } catch {
      addToast('Failed to load notifications.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await apolloClient.mutate({ mutation: MARK_ALL_READ });
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      window.dispatchEvent(new CustomEvent('notifications-cleared'));
    } catch {
      addToast('Failed to mark all as read.', 'error');
    }
  };

  const handleNotificationPress = (notification: Notification) => {
    onClose();
    if (notification.type === 'FRIEND_REQUEST' || notification.type === 'FRIEND_ACCEPTED') {
      router.push('/friends');
    } else {
      router.push('/notifications');
    }
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-ink-black/60 backdrop-blur-[2px] z-[60]" onClick={onClose} />
      )}

      <div className={`fixed bottom-0 left-0 w-full h-[60vh] rounded-t-2xl md:top-0 md:bottom-auto md:left-auto md:right-0 md:h-full md:w-[400px] md:rounded-none bg-surface shadow-2xl z-[70] border-l border-outline-variant transform transition-transform duration-300 ease-in-out ${open ? 'translate-x-0 md:translate-y-0' : 'translate-x-full md:translate-y-full md:translate-x-0'}`}>
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
            <h2 className="font-display text-headline-h3 font-bold text-primary">Notifications</h2>
            <button
              onClick={onClose}
              className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors"
            >
              close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-4 rounded-lg bg-surface-container-high animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface-container-highest" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-surface-container-highest rounded w-3/4" />
                      <div className="h-3 bg-surface-container-highest rounded w-1/4" />
                    </div>
                  </div>
                </div>
              ))
            ) : notifications.length > 0 ? (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  type={n.type}
                  body={getNotificationBody(n)}
                  timestamp={relativeTime(n.createdAt)}
                  read={!!n.readAt}
                  onPress={() => handleNotificationPress(n)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl mb-2">notifications_off</span>
                <p className="font-body-mobile">No notifications yet.</p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-outline-variant text-center bg-surface-container-lowest space-y-2">
            {notifications.some((n) => !n.readAt) && (
              <button
                onClick={handleMarkAllRead}
                className="text-info font-bold text-small hover:underline block w-full"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={() => { onClose(); router.push('/notifications'); }}
              className="text-primary font-bold hover:underline"
            >
              View All Notifications
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
