import {
  UserRole,
  GroupVisibility,
  GroupMemberRole,
  GroupMemberStatus,
  FriendshipStatus,
  ConversationType,
  BookAccessLevel,
  BookStatus,
  AnnouncementStatus,
  AnnouncementCategory,
  GroupCategory,
  NotificationType,
  JWT_ACCESS_EXPIRY,
  JWT_REFRESH_EXPIRY_DAYS,
  VERSE_CACHE_TTL_HOURS,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_UPLOAD_MIMETYPES,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_AUTH_MAX,
} from '../enums.js';

describe('UserRole', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(UserRole)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(UserRole.ADMIN).toBe('ADMIN');
    expect(UserRole.MODERATOR).toBe('MODERATOR');
    expect(UserRole.MEMBER).toBe('MEMBER');
  });
});

describe('GroupVisibility', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(GroupVisibility)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(GroupVisibility.PUBLIC).toBe('PUBLIC');
    expect(GroupVisibility.PRIVATE).toBe('PRIVATE');
  });
});

describe('GroupMemberRole', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(GroupMemberRole)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(GroupMemberRole.OWNER).toBe('OWNER');
    expect(GroupMemberRole.MEMBER).toBe('MEMBER');
  });
});

describe('GroupMemberStatus', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(GroupMemberStatus)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(GroupMemberStatus.ACTIVE).toBe('ACTIVE');
    expect(GroupMemberStatus.PENDING).toBe('PENDING');
    expect(GroupMemberStatus.BANNED).toBe('BANNED');
  });
});

describe('FriendshipStatus', () => {
  it('should have exactly 4 members', () => {
    expect(Object.keys(FriendshipStatus)).toHaveLength(4);
  });

  it('should have correct values', () => {
    expect(FriendshipStatus.PENDING).toBe('PENDING');
    expect(FriendshipStatus.ACCEPTED).toBe('ACCEPTED');
    expect(FriendshipStatus.REJECTED).toBe('REJECTED');
    expect(FriendshipStatus.BLOCKED).toBe('BLOCKED');
  });
});

describe('ConversationType', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(ConversationType)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(ConversationType.DIRECT).toBe('DIRECT');
    expect(ConversationType.GROUP).toBe('GROUP');
  });
});

describe('BookAccessLevel', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(BookAccessLevel)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(BookAccessLevel.FREE).toBe('FREE');
    expect(BookAccessLevel.RESTRICTED).toBe('RESTRICTED');
  });
});

describe('BookStatus', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(BookStatus)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(BookStatus.DRAFT).toBe('DRAFT');
    expect(BookStatus.PUBLISHED).toBe('PUBLISHED');
    expect(BookStatus.COMING_SOON).toBe('COMING_SOON');
  });
});

describe('AnnouncementStatus', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(AnnouncementStatus)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(AnnouncementStatus.DRAFT).toBe('DRAFT');
    expect(AnnouncementStatus.PUBLISHED).toBe('PUBLISHED');
    expect(AnnouncementStatus.ARCHIVED).toBe('ARCHIVED');
  });
});

describe('AnnouncementCategory', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(AnnouncementCategory)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(AnnouncementCategory.EVENT).toBe('EVENT');
    expect(AnnouncementCategory.UPDATE).toBe('UPDATE');
    expect(AnnouncementCategory.GENERAL).toBe('GENERAL');
  });
});

describe('GroupCategory', () => {
  it('should have exactly 5 members', () => {
    expect(Object.keys(GroupCategory)).toHaveLength(5);
  });

  it('should have correct values', () => {
    expect(GroupCategory.BIBLICAL_STUDIES).toBe('BIBLICAL_STUDIES');
    expect(GroupCategory.MODERN_FICTION).toBe('MODERN_FICTION');
    expect(GroupCategory.HISTORICAL).toBe('HISTORICAL');
    expect(GroupCategory.PHILOSOPHY).toBe('PHILOSOPHY');
    expect(GroupCategory.YOUNG_ADULT).toBe('YOUNG_ADULT');
  });
});

describe('NotificationType', () => {
  it('should have exactly 6 members', () => {
    expect(Object.keys(NotificationType)).toHaveLength(6);
  });

  it('should have correct values', () => {
    expect(NotificationType.FRIEND_REQUEST).toBe('FRIEND_REQUEST');
    expect(NotificationType.FRIEND_ACCEPTED).toBe('FRIEND_ACCEPTED');
    expect(NotificationType.GROUP_INVITE).toBe('GROUP_INVITE');
    expect(NotificationType.GROUP_UPDATE).toBe('GROUP_UPDATE');
    expect(NotificationType.ANNOUNCEMENT).toBe('ANNOUNCEMENT');
    expect(NotificationType.SYSTEM).toBe('SYSTEM');
  });
});

describe('Constants', () => {
  it('JWT_ACCESS_EXPIRY should be 15m', () => {
    expect(JWT_ACCESS_EXPIRY).toBe('15m');
  });

  it('JWT_REFRESH_EXPIRY_DAYS should be 7', () => {
    expect(JWT_REFRESH_EXPIRY_DAYS).toBe(7);
  });

  it('VERSE_CACHE_TTL_HOURS should be 24', () => {
    expect(VERSE_CACHE_TTL_HOURS).toBe(24);
  });

  it('MAX_FILE_SIZE_BYTES should be 50 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('ALLOWED_UPLOAD_MIMETYPES should contain only application/pdf', () => {
    expect(ALLOWED_UPLOAD_MIMETYPES).toEqual(['application/pdf']);
  });

  it('RATE_LIMIT_AUTH_WINDOW_MS should be 15 minutes', () => {
    expect(RATE_LIMIT_AUTH_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it('RATE_LIMIT_AUTH_MAX should be 10', () => {
    expect(RATE_LIMIT_AUTH_MAX).toBe(10);
  });
});
