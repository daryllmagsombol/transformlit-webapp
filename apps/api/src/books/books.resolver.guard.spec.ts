import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { BooksResolver } from './books.resolver.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UserRole } from '@transformlit/shared';

const guardsOf = (m: string) =>
  Reflect.getMetadata(GUARDS_METADATA, BooksResolver.prototype[m]) ?? [];
const rolesOf = (m: string) =>
  Reflect.getMetadata(ROLES_KEY, BooksResolver.prototype[m]);

describe('BooksResolver admin guards', () => {
  it('guards uploadBook with JwtAuthGuard + RolesGuard(ADMIN)', () => {
    expect(guardsOf('uploadBook')).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(rolesOf('uploadBook')).toEqual([UserRole.ADMIN]);
  });

  it.each(['updateBook', 'deleteBook', 'retryBookConversion', 'uploadPdf'])(
    'guards %s with staff roles',
    (m) => {
      expect(guardsOf(m)).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
      expect(rolesOf(m)).toEqual([UserRole.ADMIN, UserRole.MODERATOR]);
    },
  );
});
