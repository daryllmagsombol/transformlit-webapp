// ── Barrel exports ────────────────────────────────────────────────────────
export * from './enums.js';
export * from './schemas/index.js';
export * from './types/index.js';

// Explicit enum re-exports (TS 6 compat)
export {
  UserRole,
  GroupVisibility,
  GroupMemberRole,
  GroupMemberStatus,
  FriendshipStatus,
  ConversationType,
  BookAccessLevel,
  BookStatus,
  AnnouncementStatus,
  NotificationType,
} from './enums.js';
export type {
  RegisterLocalInput,
  LoginLocalInput,
  RefreshTokenInput,
  UpdateProfileInput,
  CreateGroupInput,
  UpdateGroupInput,
  FriendRequestInput,
  SendMessageInput,
  MessagesQueryInput,
  UploadBookInput,
  UpdateBookInput,
  SaveProgressInput,
  AddBookmarkInput,
  AddHighlightInput,
  PublishAnnouncementInput,
  UpdateAnnouncementInput,
  CursorPaginationInput,
} from './schemas/index.js';

