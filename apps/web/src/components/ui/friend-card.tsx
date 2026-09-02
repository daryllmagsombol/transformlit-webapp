'use client';

import { UserAvatar } from './user-avatar';
import { ChevronRightIcon } from './icons';

interface FriendCardProps {
  name: string;
  bio?: string;
  avatarUrl?: string | null;
  mutualGroups?: number;
  onPress: () => void;
  statusBadge?: React.ReactNode;
}

export function FriendCard({ name, bio, avatarUrl, mutualGroups, onPress, statusBadge }: FriendCardProps) {
  return (
    <button
      onClick={onPress}
      className="group flex items-center p-4 bg-surface-container-lowest border border-outline-variant rounded-xl hover:border-primary transition-all cursor-pointer w-full text-left"
    >
      <UserAvatar avatarUrl={avatarUrl} displayName={name} size="md" />
      <div className="ml-4 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-display font-headline-h4 text-on-surface group-hover:text-primary transition-colors truncate">
            {name}
          </p>
          {statusBadge}
        </div>
        {bio && (
          <p className="font-body-mobile text-sm text-on-surface-variant line-clamp-1">{bio}</p>
        )}
        {mutualGroups !== undefined && mutualGroups > 0 && (
          <span className="inline-block mt-1 px-2 py-0.5 bg-secondary-container/50 text-on-secondary-container text-[10px] font-bold rounded-full uppercase font-micro">
            {mutualGroups} mutual group{mutualGroups !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ChevronRightIcon className="w-6 h-6 text-on-surface-variant group-hover:text-primary flex-shrink-0" />
    </button>
  );
}
