// ── User ──────────────────────────────────────────────────────────────────
export interface GraphQLUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  role: string;
  lastLoginAt?: string | null;
  createdAt: string;
}

// ── Group ──────────────────────────────────────────────────────────────────
export interface GraphQLGroup {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  visibility: string;
  category?: string | null;
  coverImageUrl?: string | null;
  featured: boolean;
  memberCount: number;
  myRole?: string | null;
  createdAt: string;
}

export interface GraphQLGroupMember {
  id: string;
  user: GraphQLUser;
  role: string;
  status: string;
  joinedAt: string;
}

// ── Friendship ─────────────────────────────────────────────────────────────
export interface GraphQLFriendship {
  id: string;
  requester: GraphQLUser;
  addressee: GraphQLUser;
  status: string;
  createdAt: string;
}

// ── Chat ───────────────────────────────────────────────────────────────────
export interface GraphQLConversation {
  id: string;
  type: string;
  groupId?: string | null;
  lastMessage?: GraphQLMessage | null;
  members: GraphQLConversationMember[];
  createdAt: string;
}

export interface GraphQLConversationMember {
  id: string;
  user: GraphQLUser;
  lastReadAt?: string | null;
}

export interface GraphQLMessage {
  id: string;
  conversationId: string;
  sender: GraphQLUser;
  body: string;
  editedAt?: string | null;
  createdAt: string;
}

// ── Book ───────────────────────────────────────────────────────────────────
export interface GraphQLBook {
  id: string;
  title: string;
  author?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  accessLevel: string;
  status: string;
  totalPages?: number | null;
  myProgress?: GraphQLBookProgress | null;
  createdAt: string;
}

export interface GraphQLBookProgress {
  currentPage: number;
  scrollY?: number | null;
  completedAt?: string | null;
  lastReadAt: string;
}

export interface GraphQLBookmark {
  id: string;
  page: number;
  label?: string | null;
  color?: string | null;
  createdAt: string;
}

export interface GraphQLHighlight {
  id: string;
  page: number;
  text: string;
  note?: string | null;
  color?: string | null;
  createdAt: string;
}

// ── Feed ──────────────────────────────────────────────────────────────────
export interface GraphQLAnnouncement {
  id: string;
  title: string;
  body: string;
  status: string;
  category: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdBy: GraphQLUser;
  createdAt: string;
}

export interface GraphQLVerseOfDay {
  date: string;
  text: string;
  reference: string;
  version: string;
}

// ── Notification ───────────────────────────────────────────────────────────
export interface GraphQLNotification {
  id: string;
  type: string;
  payload?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt: string;
}

// ── Pagination ─────────────────────────────────────────────────────────────
export interface PaginationInput {
  cursor?: string | null;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor?: string | null;
}
