'use client';

import { UserAvatar } from './user-avatar';

interface SuggestedFriendCardProps {
  name: string;
  tag: string;
  avatarUrl?: string | null;
  onAdd: () => void;
}

export function SuggestedFriendCard({ name, tag, avatarUrl, onAdd }: SuggestedFriendCardProps) {
  return (
    <div className="snap-start min-w-[200px] bg-surface-container-low border border-outline-variant p-5 rounded-xl flex flex-col items-center text-center shadow-sm hover:shadow-md transition-shadow">
      <div className="mb-3 ring-4 ring-white shadow-inner rounded-full">
        <UserAvatar avatarUrl={avatarUrl} displayName={name} size="md" />
      </div>
      <p className="font-display font-headline-h4 text-on-surface truncate w-full">{name}</p>
      <p className="font-small text-on-surface-variant mb-4 truncate w-full">{tag}</p>
      <button
        onClick={onAdd}
        className="w-full bg-secondary text-on-secondary py-2 rounded-lg font-small font-bold hover:opacity-90 active:scale-95 transition-all"
      >
        Add Friend
      </button>
    </div>
  );
}
