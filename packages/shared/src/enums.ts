// ── Enums ──────────────────────────────────────────────────────────────────

export enum UserRole {
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
  MEMBER = 'MEMBER',
}

export enum GroupVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum GroupMemberRole {
  OWNER = 'OWNER',
  MODERATOR = 'MODERATOR',
  MEMBER = 'MEMBER',
}

export enum GroupMemberStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  BANNED = 'BANNED',
}

export enum FriendshipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  BLOCKED = 'BLOCKED',
}

export enum ConversationType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
}

export enum BookAccessLevel {
  FREE = 'FREE',
  RESTRICTED = 'RESTRICTED',
}

export enum BookStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  COMING_SOON = 'COMING_SOON',
}

export enum AnnouncementStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export enum AnnouncementCategory {
  EVENT = 'EVENT',
  UPDATE = 'UPDATE',
  GENERAL = 'GENERAL',
}

export enum GroupCategory {
  BIBLICAL_STUDIES = 'BIBLICAL_STUDIES',
  MODERN_FICTION = 'MODERN_FICTION',
  HISTORICAL = 'HISTORICAL',
  PHILOSOPHY = 'PHILOSOPHY',
  YOUNG_ADULT = 'YOUNG_ADULT',
}

export enum NotificationType {
  FRIEND_REQUEST = 'FRIEND_REQUEST',
  FRIEND_ACCEPTED = 'FRIEND_ACCEPTED',
  GROUP_INVITE = 'GROUP_INVITE',
  GROUP_UPDATE = 'GROUP_UPDATE',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  SYSTEM = 'SYSTEM',
}

// ── Constants ──────────────────────────────────────────────────────────────

export const JWT_ACCESS_EXPIRY = '15m';
export const JWT_REFRESH_EXPIRY_DAYS = 7;
export const CHAT_POLL_INTERVAL_MS = 0; // replaced by subscriptions
export const VERSE_CACHE_TTL_HOURS = 24;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB for PDF uploads
export const ALLOWED_UPLOAD_MIMETYPES = ['application/pdf'];
export const RATE_LIMIT_AUTH_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_AUTH_MAX = 10;
