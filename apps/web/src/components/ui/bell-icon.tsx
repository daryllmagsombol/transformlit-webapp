'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { gql } from '@apollo/client';
import { apolloClient } from '../../lib/apollo-client';

const UNREAD_COUNT_QUERY = gql`
  query UnreadNotificationCount {
    unreadNotificationCount
  }
`;

const NOTIFICATION_SUBSCRIPTION = gql`
  subscription NotificationReceived($userId: String!) {
    notificationReceived(userId: $userId) {
      id
      type
      payload
      createdAt
    }
  }
`;

interface BellIconProps {
  readonly userId: string;
  readonly onClick: () => void;
}

export function BellIcon({ userId, onClick }: BellIconProps) {
  const [count, setCount] = useState(0);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await apolloClient.query<{ unreadNotificationCount: number }>({ query: UNREAD_COUNT_QUERY });
      setCount(data!.unreadNotificationCount ?? 0);
    } catch {
      // Silently fail - badge just won't show
    }
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Listen for clear event from notification panel/page
  useEffect(() => {
    const handleClear = () => fetchCount();
    globalThis.window.addEventListener('notifications-cleared', handleClear);
    return () => globalThis.window.removeEventListener('notifications-cleared', handleClear);
  }, [fetchCount]);

  // Own the live subscription in a ref keyed ONLY on userId. There is no
  // isSubscribed state in the dependency list: adding one would trigger a
  // re-render after setState, running the cleanup (unsubscribe) and then
  // re-running the effect — net result: the subscription never persists.
  // With [userId] as the sole dep the subscription survives unrelated
  // re-renders (count updates, etc.) and is torn down only when the user
  // changes or the component unmounts.
  useEffect(() => {
    if (!userId) return;

    const observable = apolloClient.subscribe({
      query: NOTIFICATION_SUBSCRIPTION,
      variables: { userId },
    });

    const subscription = observable.subscribe({
      next: () => {
        setCount((prev) => prev + 1);
      },
      error: () => {
        // Subscription error - bell still works, just no real-time updates
      },
    });

    subscriptionRef.current = subscription;

    return () => {
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [userId]);

  return (
    <button
      onClick={onClick}
      className="material-symbols-outlined text-on-surface-variant cursor-pointer p-2 hover:bg-surface-container rounded-full transition-colors relative"
      aria-label="Notifications"
    >
      notifications
      {count > 0 && (
        <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 bg-error text-on-error text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
