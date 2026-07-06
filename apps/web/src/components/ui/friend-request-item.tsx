'use client';

import { UserAvatar } from './user-avatar';

interface FriendRequestItemProps {
  name: string;
  bio?: string;
  avatarUrl?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

export function FriendRequestItem({
  name,
  bio,
  avatarUrl,
  onAccept,
  onDecline,
}: FriendRequestItemProps) {
  return (
    <div className="bg-paper-warm p-4 rounded-xl shadow-sm flex flex-col sm:flex-row items-center gap-4 border border-outline-variant/30">
      <UserAvatar avatarUrl={avatarUrl} displayName={name} size="md" />
      <div className="text-center sm:text-left flex-1">
        <p className="font-headline-h4 text-on-surface">{name}</p>
        {bio && (
          <p className="font-body-mobile text-on-surface-variant text-sm italic">{bio}</p>
        )}
      </div>
      <div className="flex gap-2 w-full sm:w-auto">
        <button
          onClick={onAccept}
          className="flex-1 sm:flex-none bg-primary text-on-primary px-4 py-2 rounded-lg font-small font-bold hover:brightness-110 active:scale-95 transition-all"
        >
          Accept
        </button>
        <button
          onClick={onDecline}
          className="flex-1 sm:flex-none bg-surface-container-highest text-on-surface-variant px-4 py-2 rounded-lg font-small font-bold hover:bg-outline-variant/20 active:scale-95 transition-all"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
