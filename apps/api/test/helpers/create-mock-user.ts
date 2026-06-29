import { randomUUID } from 'crypto';

export interface MockUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  role: 'ADMIN' | 'MODERATOR' | 'MEMBER';
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let userCounter = 0;

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  userCounter++;
  return {
    id: randomUUID(),
    email: `user${userCounter}@example.com`,
    displayName: `Test User ${userCounter}`,
    avatarUrl: null,
    bio: null,
    role: 'MEMBER',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}
