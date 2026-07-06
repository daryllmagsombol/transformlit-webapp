'use client';

import { useState, useEffect, useCallback } from 'react';
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
  userId: string;
  onClick: () => void;
}

export function BellIcon({ userId, onClick }: BellIconProps) {
  const [count, setCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await apolloClient.query({ query: UNREAD_COUNT_QUERY });
      setCount(data.unreadNotificationCount ?? 0);
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
    window.addEventListener('notifications-cleared', handleClear);
    return () => window.removeEventListener('notifications-cleared', handleClear);
  }, [fetchCount]);

  useEffect(() => {
    if (!userId || isSubscribed) return;

    setIsSubscribed(true);
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

    return () => {
      subscription.unsubscribe();
    };
  }, [userId, isSubscribed]);

  return (
    <button
      onClick={onClick}
      className="material-symbols-outlined text-on-surface-variant cursor-pointer p-2 hover:bg-surface-container rounded-full transition-colors relative"
      aria-label="Notifications"
    >
      notifications
      {count > 0 && (
        <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
