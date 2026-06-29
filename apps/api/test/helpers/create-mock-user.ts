import { randomUUID } from 'crypto';

export interface MockUser {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  role: 'ADMIN' | 'MODERATOR' | 'MEMBER';
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let userCounter = 0;

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  userCounter++;
  const email = overrides.email ?? `user${userCounter}@example.com`;
  return {
    id: randomUUID(),
    email,
    emailNormalized: email.toLowerCase(),
    passwordHash: 'mock-hash',
    displayName: `Test User ${userCounter}`,
    avatarUrl: null,
    bio: null,
    role: 'MEMBER',
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
