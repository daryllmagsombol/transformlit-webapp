'use client';

const ICON_MAP: Record<string, { icon: string; bgClass: string; textClass: string }> = {
  FRIEND_REQUEST: { icon: 'person_add', bgClass: 'bg-info/10', textClass: 'text-info' },
  FRIEND_ACCEPTED: { icon: 'person_add', bgClass: 'bg-info/10', textClass: 'text-info' },
  GROUP_INVITE: { icon: 'groups', bgClass: 'bg-success/10', textClass: 'text-success' },
  GROUP_UPDATE: { icon: 'forum', bgClass: 'bg-success/10', textClass: 'text-success' },
  ANNOUNCEMENT: { icon: 'campaign', bgClass: 'bg-warning/10', textClass: 'text-warning' },
  SYSTEM: { icon: 'update', bgClass: 'bg-error/10', textClass: 'text-error' },
};

interface NotificationItemProps {
  type: string;
  body: string;
  timestamp: string;
  read: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}

export function NotificationItem({ type, body, timestamp, read, onPress, children }: NotificationItemProps) {
  const config = ICON_MAP[type] ?? { icon: 'notifications', bgClass: 'bg-surface-container', textClass: 'text-on-surface-variant' };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(e) => e.key === 'Enter' && onPress()}
      aria-label={`Notification: ${body}`}
      className={`p-4 rounded-xl hover:bg-surface-container transition-colors cursor-pointer border border-transparent hover:border-outline-variant relative ${
        !read ? 'bg-surface-container' : 'bg-paper'
      }`}
    >
      {!read && <span className="absolute top-4 right-4 w-2 h-2 bg-info rounded-full" />}
      <div className="flex gap-3">
        <div className={`w-10 h-10 rounded-full ${config.bgClass} flex items-center justify-center flex-shrink-0`}>
          <span className={`material-symbols-outlined ${config.textClass} text-[20px]`}>
            {config.icon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-body text-on-surface leading-snug">{body}</p>
          <p className="font-micro text-micro text-on-surface-variant mt-1">{timestamp}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
