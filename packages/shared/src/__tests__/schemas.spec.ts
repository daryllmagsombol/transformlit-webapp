import {
  registerLocalSchema,
  loginLocalSchema,
  refreshTokenSchema,
  updateProfileSchema,
  createGroupSchema,
  updateGroupSchema,
  friendRequestSchema,
  sendMessageSchema,
  messagesQuerySchema,
  uploadBookSchema,
  updateBookSchema,
  saveProgressSchema,
  addBookmarkSchema,
  addHighlightSchema,
  publishAnnouncementSchema,
  updateAnnouncementSchema,
  cursorPaginationSchema,
} from '../schemas/index.js';

describe('registerLocalSchema', () => {
  it('should accept valid input', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = registerLocalSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should reject password shorter than 8 characters', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'short',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should reject password longer than 128 characters', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'a'.repeat(129),
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty displayName', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      displayName: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject displayName longer than 100 characters', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      displayName: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing fields', () => {
    const result = registerLocalSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('loginLocalSchema', () => {
  it('should accept valid input', () => {
    const result = loginLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = loginLocalSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty password', () => {
    const result = loginLocalSchema.safeParse({
      email: 'test@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing fields', () => {
    const result = loginLocalSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('refreshTokenSchema', () => {
  it('should accept valid token', () => {
    const result = refreshTokenSchema.safeParse({
      refreshToken: 'some-valid-token',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty token', () => {
    const result = refreshTokenSchema.safeParse({ refreshToken: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing field', () => {
    const result = refreshTokenSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('should accept all valid fields', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'New Name',
      bio: 'A short bio',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty object (all fields optional)', () => {
    const result = updateProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should reject empty displayName', () => {
    const result = updateProfileSchema.safeParse({ displayName: '' });
    expect(result.success).toBe(false);
  });

  it('should reject displayName longer than 100 characters', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('should reject bio longer than 500 characters', () => {
    const result = updateProfileSchema.safeParse({ bio: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('should reject invalid avatarUrl', () => {
    const result = updateProfileSchema.safeParse({
      avatarUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid avatarUrl', () => {
    const result = updateProfileSchema.safeParse({
      avatarUrl: 'https://example.com/photo.png',
    });
    expect(result.success).toBe(true);
  });
});

describe('createGroupSchema', () => {
  it('should accept valid input with defaults', () => {
    const result = createGroupSchema.safeParse({ name: 'Book Club' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('PUBLIC');
    }
  });

  it('should accept valid input with all fields', () => {
    const result = createGroupSchema.safeParse({
      name: 'Book Club',
      description: 'A group for reading',
      visibility: 'PRIVATE',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = createGroupSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject name longer than 100 characters', () => {
    const result = createGroupSchema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('should reject description longer than 1000 characters', () => {
    const result = createGroupSchema.safeParse({
      name: 'Book Club',
      description: 'a'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid visibility', () => {
    const result = createGroupSchema.safeParse({
      name: 'Book Club',
      visibility: 'INVALID',
    });
    expect(result.success).toBe(false);
  });

  it('should default visibility to PUBLIC', () => {
    const result = createGroupSchema.safeParse({ name: 'Book Club' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('PUBLIC');
    }
  });
});

describe('updateGroupSchema', () => {
  it('should accept empty object (all fields optional)', () => {
    const result = updateGroupSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept partial update', () => {
    const result = updateGroupSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = updateGroupSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid visibility', () => {
    const result = updateGroupSchema.safeParse({ visibility: 'SECRET' });
    expect(result.success).toBe(false);
  });
});

describe('friendRequestSchema', () => {
  it('should accept valid UUID', () => {
    const result = friendRequestSchema.safeParse({
      addresseeId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid UUID', () => {
    const result = friendRequestSchema.safeParse({
      addresseeId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing field', () => {
    const result = friendRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('sendMessageSchema', () => {
  it('should accept valid input', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      body: 'Hello world',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid conversationId', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: 'not-a-uuid',
      body: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty body', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      body: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject body longer than 5000 characters', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      body: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe('messagesQuerySchema', () => {
  it('should accept valid input with defaults', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it('should accept custom limit', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('should reject limit below 1', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject limit above 50', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 51,
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional cursor', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      cursor: 'some-cursor-value',
    });
    expect(result.success).toBe(true);
  });

  it('should default limit to 25', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });
});

describe('uploadBookSchema', () => {
  it('should accept valid input with defaults', () => {
    const result = uploadBookSchema.safeParse({ title: 'My Book' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessLevel).toBe('FREE');
      expect(result.data.currency).toBe('USD');
    }
  });

  it('should accept valid input with all fields', () => {
    const result = uploadBookSchema.safeParse({
      title: 'My Book',
      author: 'Author Name',
      description: 'A great book',
      accessLevel: 'RESTRICTED',
      price: 9.99,
      currency: 'EUR',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty title', () => {
    const result = uploadBookSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('should reject title longer than 200 characters', () => {
    const result = uploadBookSchema.safeParse({ title: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('should reject negative price', () => {
    const result = uploadBookSchema.safeParse({
      title: 'My Book',
      price: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid accessLevel', () => {
    const result = uploadBookSchema.safeParse({
      title: 'My Book',
      accessLevel: 'PAID',
    });
    expect(result.success).toBe(false);
  });

  it('should default accessLevel to FREE and currency to USD', () => {
    const result = uploadBookSchema.safeParse({ title: 'My Book' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessLevel).toBe('FREE');
      expect(result.data.currency).toBe('USD');
    }
  });
});

describe('updateBookSchema', () => {
  it('should accept empty object (all fields optional)', () => {
    const result = updateBookSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept partial update', () => {
    const result = updateBookSchema.safeParse({
      title: 'Updated Title',
      status: 'PUBLISHED',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid status', () => {
    const result = updateBookSchema.safeParse({ status: 'DELETED' });
    expect(result.success).toBe(false);
  });

  it('should reject empty title', () => {
    const result = updateBookSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('should reject negative price', () => {
    const result = updateBookSchema.safeParse({ price: -5 });
    expect(result.success).toBe(false);
  });
});

describe('saveProgressSchema', () => {
  it('should accept valid input', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 42,
    });
    expect(result.success).toBe(true);
  });

  it('should accept input with scrollY', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 10,
      scrollY: 250.5,
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid bookId', () => {
    const result = saveProgressSchema.safeParse({
      bookId: 'not-a-uuid',
      currentPage: 1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject page below 1', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative scrollY', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 1,
      scrollY: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer currentPage', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('addBookmarkSchema', () => {
  it('should accept valid input', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
    });
    expect(result.success).toBe(true);
  });

  it('should accept input with optional fields', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
      label: 'Important section',
      color: '#ff0000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid bookId', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: 'not-a-uuid',
      page: 1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject page below 1', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject label longer than 200 characters', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      label: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe('addHighlightSchema', () => {
  it('should accept valid input', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
      text: 'Highlighted text passage',
    });
    expect(result.success).toBe(true);
  });

  it('should accept input with optional fields', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
      text: 'Highlighted text',
      note: 'My note about this',
      color: '#ffff00',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty text', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject text longer than 10000 characters', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      text: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject note longer than 5000 characters', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      text: 'Some text',
      note: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid bookId', () => {
    const result = addHighlightSchema.safeParse({
      bookId: 'not-a-uuid',
      page: 1,
      text: 'Some text',
    });
    expect(result.success).toBe(false);
  });

  it('should reject page below 1', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 0,
      text: 'Some text',
    });
    expect(result.success).toBe(false);
  });
});

describe('publishAnnouncementSchema', () => {
  it('should accept valid input with defaults', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'New Event',
      body: 'Join us for an exciting event',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('GENERAL');
    }
  });

  it('should accept valid input with all fields', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'New Event',
      body: 'Join us for an exciting event',
      category: 'EVENT',
      publishAt: '2026-07-01T10:00:00Z',
      expiresAt: '2026-07-31T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty title', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: '',
      body: 'Some body',
    });
    expect(result.success).toBe(false);
  });

  it('should reject title longer than 200 characters', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'a'.repeat(201),
      body: 'Some body',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty body', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject body longer than 10000 characters', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid category', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'Body',
      category: 'NEWS',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid datetime format for publishAt', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'Body',
      publishAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('should default category to GENERAL', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'Body',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('GENERAL');
    }
  });
});

describe('updateAnnouncementSchema', () => {
  it('should accept empty object (all fields optional)', () => {
    const result = updateAnnouncementSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept partial update', () => {
    const result = updateAnnouncementSchema.safeParse({
      title: 'Updated Title',
      status: 'ARCHIVED',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid status', () => {
    const result = updateAnnouncementSchema.safeParse({
      status: 'DELETED',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid category', () => {
    const result = updateAnnouncementSchema.safeParse({
      category: 'NEWS',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty title', () => {
    const result = updateAnnouncementSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('should accept valid status transitions', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'ARCHIVED']) {
      const result = updateAnnouncementSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });
});

describe('cursorPaginationSchema', () => {
  it('should accept empty object with defaults', () => {
    const result = cursorPaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it('should accept valid cursor and limit', () => {
    const result = cursorPaginationSchema.safeParse({
      cursor: 'abc123',
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('should reject limit below 1', () => {
    const result = cursorPaginationSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject limit above 100', () => {
    const result = cursorPaginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer limit', () => {
    const result = cursorPaginationSchema.safeParse({ limit: 10.5 });
    expect(result.success).toBe(false);
  });

  it('should default limit to 25', () => {
    const result = cursorPaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });
});
