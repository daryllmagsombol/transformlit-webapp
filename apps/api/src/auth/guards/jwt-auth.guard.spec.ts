/// <reference types="jest" />
import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn((context: ExecutionContext) => ({
      getContext: () => ({
        req: (context as any).__req,
      }),
    })),
  },
}));

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should extract request from GraphQL context', () => {
    const mockReq = { user: { id: 'user-1', role: 'MEMBER' } };
    const context = { __req: mockReq } as unknown as ExecutionContext;

    const result = guard.getRequest(context);
    expect(result).toBe(mockReq);
  });

  it('should return the req object from GQL context', () => {
    const mockReq = { headers: { authorization: 'Bearer token' } };
    const context = { __req: mockReq } as unknown as ExecutionContext;

    const result = guard.getRequest(context);
    expect(result).toEqual(mockReq);
    expect(result.headers.authorization).toBe('Bearer token');
  });
});
