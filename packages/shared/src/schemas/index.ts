import { z } from 'zod';
import { UserRole } from '../enums.js';

// ── Auth ───────────────────────────────────────────────────────────────────

export const registerLocalSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
});

export const loginLocalSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterLocalInput = z.infer<typeof registerLocalSchema>;
export type LoginLocalInput = z.infer<typeof loginLocalSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// ── User ───────────────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ── Group ──────────────────────────────────────────────────────────────────

export const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

// ── Friend ─────────────────────────────────────────────────────────────────

export const friendRequestSchema = z.object({
  addresseeId: z.string().uuid(),
});

export type FriendRequestInput = z.infer<typeof friendRequestSchema>;

// ── Chat ───────────────────────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

export const messagesQuerySchema = z.object({
  conversationId: z.string().uuid(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(25),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MessagesQueryInput = z.infer<typeof messagesQuerySchema>;

// ── Book ───────────────────────────────────────────────────────────────────

export const uploadBookSchema = z.object({
  title: z.string().min(1).max(200),
  author: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  accessLevel: z.enum(['FREE', 'RESTRICTED']).default('FREE'),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).default('USD'),
});

export const updateBookSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  author: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  accessLevel: z.enum(['FREE', 'RESTRICTED']).optional(),
  price: z.number().min(0).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'COMING_SOON']).optional(),
});

export const saveProgressSchema = z.object({
  bookId: z.string().uuid(),
  currentPage: z.number().int().min(1),
  scrollY: z.number().min(0).optional(),
});

export const addBookmarkSchema = z.object({
  bookId: z.string().uuid(),
  page: z.number().int().min(1),
  label: z.string().max(200).optional(),
  color: z.string().optional(),
});

export const addHighlightSchema = z.object({
  bookId: z.string().uuid(),
  page: z.number().int().min(1),
  text: z.string().min(1).max(10000),
  note: z.string().max(5000).optional(),
  color: z.string().optional(),
});

export type UploadBookInput = z.infer<typeof uploadBookSchema>;
export type UpdateBookInput = z.infer<typeof updateBookSchema>;
export type SaveProgressInput = z.infer<typeof saveProgressSchema>;
export type AddBookmarkInput = z.infer<typeof addBookmarkSchema>;
export type AddHighlightInput = z.infer<typeof addHighlightSchema>;

// ── Feed ───────────────────────────────────────────────────────────────────

export const publishAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  category: z.enum(['EVENT', 'UPDATE', 'GENERAL']).default('GENERAL'),
  publishAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(10000).optional(),
  category: z.enum(['EVENT', 'UPDATE', 'GENERAL']).optional(),
  publishAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export type PublishAnnouncementInput = z.infer<typeof publishAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

// ── Pagination ─────────────────────────────────────────────────────────────

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;
