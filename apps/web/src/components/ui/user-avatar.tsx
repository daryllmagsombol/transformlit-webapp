type UserAvatarProps = {
  avatarUrl?: string | null;
  displayName?: string;
  size?: 'sm' | 'md';
};

export function UserAvatar({ avatarUrl, displayName, size = 'md' }: UserAvatarProps) {
  const sizeClass = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  const initial = displayName?.charAt(0)?.toUpperCase() ?? 'U';

  return (
    <div
      className={`${sizeClass} rounded-full bg-primary-fixed overflow-hidden border border-primary/20 flex items-center justify-center shrink-0`}
    >
      {avatarUrl ? (
        <img className="w-full h-full object-cover" src={avatarUrl} alt={displayName ?? 'User'} />
      ) : (
        <span className={`${textSize} font-bold text-on-primary-container`}>{initial}</span>
      )}
    </div>
  );
}
