/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../auth/models/auth.model', () => ({
  User: class {},
}));

jest.mock('../auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class {},
}));

jest.mock('../common/decorators/current-user.decorator', () => ({
  CurrentUser: () => () => {},
}));

import { UsersResolver } from './users.resolver';
import { UsersService } from './users.service';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  bio: 'A bio',
  avatarUrl: null,
  role: 'USER',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
  deletedAt: null,
};

describe('UsersResolver', () => {
  let resolver: UsersResolver;
  let service: UsersService;

  beforeEach(async () => {
    const mockUsersService = {
      findById: jest.fn().mockResolvedValue(mockUser),
      listUsers: jest.fn().mockResolvedValue([mockUser]),
      searchUsers: jest.fn().mockResolvedValue([mockUser]),
      updateProfile: jest.fn().mockResolvedValue(mockUser),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersResolver,
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    resolver = module.get<UsersResolver>(UsersResolver);
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('me', () => {
    it('should delegate to findById with current user id', async () => {
      const result = await resolver.me({ id: 'user-1' });
      expect(service.findById).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(mockUser);
    });
  });

  describe('users', () => {
    it('should delegate to listUsers with current user id', async () => {
      const result = await resolver.users({ id: 'user-1' });
      expect(service.listUsers).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([mockUser]);
    });
  });

  describe('searchUsers', () => {
    it('should delegate to searchUsers with current user id and query', async () => {
      const result = await resolver.searchUsers({ id: 'user-1' }, 'test');
      expect(service.searchUsers).toHaveBeenCalledWith('test', 'user-1');
      expect(result).toEqual([mockUser]);
    });
  });

  describe('updateProfile', () => {
    it('should delegate to updateProfile with user id and input', async () => {
      const input = { displayName: 'New Name' };
      const updated = { ...mockUser, displayName: 'New Name' };
      (service.updateProfile as jest.Mock).mockResolvedValue(updated);

      const result = await resolver.updateProfile({ id: 'user-1' }, input);
      expect(service.updateProfile).toHaveBeenCalledWith('user-1', input);
      expect(result).toEqual(updated);
    });
  });
});
