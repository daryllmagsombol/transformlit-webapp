/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { FriendsResolver } from './friends.resolver';
import { FriendsService } from './friends.service';

const mockFriendship = {
  id: 'friendship-1',
  requesterId: 'user-1',
  addresseeId: 'user-2',
  status: 'PENDING',
  createdAt: new Date('2024-01-01'),
};

const mockUser = { id: 'user-1' };

describe('FriendsResolver', () => {
  let resolver: FriendsResolver;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockService = {
      listFriends: jest.fn().mockResolvedValue([mockFriendship]),
      listRequests: jest.fn().mockResolvedValue([mockFriendship]),
      sendRequest: jest.fn().mockResolvedValue(mockFriendship),
      acceptRequest: jest.fn().mockResolvedValue({ ...mockFriendship, status: 'ACCEPTED' }),
      rejectRequest: jest.fn().mockResolvedValue({ ...mockFriendship, status: 'REJECTED' }),
      removeFriend: jest.fn().mockResolvedValue(mockFriendship),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsResolver,
        { provide: FriendsService, useValue: mockService },
      ],
    }).compile();

    resolver = module.get<FriendsResolver>(FriendsResolver);
    service = module.get(FriendsService) as any;
    jest.clearAllMocks();
  });

  // ── friends query ───────────────────────────────────────────────────────────

  describe('friends', () => {
    it('should delegate to listFriends with user id', async () => {
      const result = await resolver.friends(mockUser);
      expect(service.listFriends).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([mockFriendship]);
    });
  });

  // ── friendRequests query ────────────────────────────────────────────────────

  describe('friendRequests', () => {
    it('should delegate to listRequests with user id', async () => {
      const result = await resolver.friendRequests(mockUser);
      expect(service.listRequests).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([mockFriendship]);
    });
  });

  // ── sendFriendRequest mutation ──────────────────────────────────────────────

  describe('sendFriendRequest', () => {
    it('should delegate to sendRequest with user id and addresseeId', async () => {
      const result = await resolver.sendFriendRequest(mockUser, 'user-2');
      expect(service.sendRequest).toHaveBeenCalledWith('user-1', 'user-2');
      expect(result).toEqual(mockFriendship);
    });
  });

  // ── acceptFriendRequest mutation ────────────────────────────────────────────

  describe('acceptFriendRequest', () => {
    it('should delegate to acceptRequest with friendshipId and user id', async () => {
      const result = await resolver.acceptFriendRequest(mockUser, 'friendship-1');
      expect(service.acceptRequest).toHaveBeenCalledWith('friendship-1', 'user-1');
      expect(result).toEqual(expect.objectContaining({ status: 'ACCEPTED' }));
    });
  });

  // ── rejectFriendRequest mutation ────────────────────────────────────────────

  describe('rejectFriendRequest', () => {
    it('should delegate to rejectRequest with friendshipId and user id', async () => {
      const result = await resolver.rejectFriendRequest(mockUser, 'friendship-1');
      expect(service.rejectRequest).toHaveBeenCalledWith('friendship-1', 'user-1');
      expect(result).toEqual(expect.objectContaining({ status: 'REJECTED' }));
    });
  });

  // ── removeFriend mutation ───────────────────────────────────────────────────

  describe('removeFriend', () => {
    it('should delegate to removeFriend with friendshipId', async () => {
      const result = await resolver.removeFriend('friendship-1');
      expect(service.removeFriend).toHaveBeenCalledWith('friendship-1');
      expect(result).toEqual(mockFriendship);
    });
  });
});
