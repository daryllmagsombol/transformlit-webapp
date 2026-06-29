import { randomUUID } from 'crypto';
import { createMockUser, MockUser } from './create-mock-user';

export interface MockGroupMember {
  id: string;
  userId: string;
  user: MockUser;
  role: 'OWNER' | 'MEMBER';
  status: 'ACTIVE' | 'PENDING' | 'BANNED';
  joinedAt: Date;
}

export interface MockGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  category: string | null;
  coverImageUrl: string | null;
  featured: boolean;
  createdBy: MockUser;
  createdById: string;
  members: MockGroupMember[];
  createdAt: Date;
  updatedAt: Date;
}

let groupCounter = 0;

export function createMockGroup(
  overrides: Partial<MockGroup> = {},
): MockGroup {
  groupCounter++;
  const creator = overrides.createdBy ?? createMockUser();
  return {
    id: randomUUID(),
    name: `Test Group ${groupCounter}`,
    slug: `test-group-${groupCounter}`,
    description: `Description for test group ${groupCounter}`,
    visibility: 'PUBLIC',
    category: null,
    coverImageUrl: null,
    featured: false,
    createdBy: creator,
    createdById: creator.id,
    members: [
      {
        id: randomUUID(),
        userId: creator.id,
        user: creator,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date('2026-01-01'),
      },
    ],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}
