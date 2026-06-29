/// <reference types="jest" />
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn((context: ExecutionContext) => ({
      getContext: () => ({
        req: (context as any).__req ?? {},
      }),
    })),
  },
}));

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
    jest.clearAllMocks();
  });

  const createMockContext = (user?: { id: string; role: string }): ExecutionContext => {
    return {
      __req: { user },
      getHandler: jest.fn().mockReturnValue(() => {}),
      getClass: jest.fn().mockReturnValue(class {}),
    } as unknown as ExecutionContext;
  };

  it('should return true when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ id: 'user-1', role: 'MEMBER' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true when user has the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = createMockContext({ id: 'user-1', role: 'ADMIN' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true when user role is in the required roles list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'MODERATOR']);
    const context = createMockContext({ id: 'user-1', role: 'MODERATOR' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return false when user lacks the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = createMockContext({ id: 'user-1', role: 'MEMBER' });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should return false when no user is in the context', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = createMockContext(undefined);

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should return false when user is null and roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['MEMBER']);
    const context = {
      __req: {},
      getHandler: jest.fn().mockReturnValue(() => {}),
      getClass: jest.fn().mockReturnValue(class {}),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should check roles using ROLES_KEY on handler and class', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const mockContext = createMockContext({ id: 'user-1', role: 'ADMIN' });

    guard.canActivate(mockContext);

    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });
});
