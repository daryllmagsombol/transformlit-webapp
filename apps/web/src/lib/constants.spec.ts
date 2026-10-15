// The web Jest harness cannot transform the ESM `@transformlit/shared` dist
// (existing web specs only ever `import type`). The enum is consumed at runtime
// here, so it is mocked with its real string values.
jest.mock('@transformlit/shared', () => ({
  UserRole: { ADMIN: 'ADMIN', MODERATOR: 'MODERATOR', MEMBER: 'MEMBER' },
}));

import { UserRole } from '@transformlit/shared';
import {
  CATEGORY_CONFIG,
  getCategoryConfig,
  GROUP_CATEGORIES,
  GROUP_METADATA,
  getGroupMeta,
  QUICK_TRACK_CHAPTERS,
  SIDEBAR_NAV_ITEMS,
  BOTTOM_NAV_ITEMS,
  getSidebarNavItems,
} from './constants';

describe('SIDEBAR_NAV_ITEMS', () => {
  it('has the expected number of items including the role-restricted Admin entry', () => {
    expect(SIDEBAR_NAV_ITEMS).toHaveLength(8);
  });

  it.each(SIDEBAR_NAV_ITEMS)('$label has label, href, and icon', (item) => {
    expect(item.label).toBeTruthy();
    expect(item.href).toMatch(/^\//);
    expect(item.icon).toBeTruthy();
  });

  it('contains Feed, Bible, Friends, Chat, Groups, Books, Downloads, and Admin', () => {
    const labels = SIDEBAR_NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual([
      'Feed',
      'Bible',
      'Friends',
      'Chat',
      'Groups',
      'Books',
      'Downloads',
      'Admin',
    ]);
  });

  it('restricts the Admin entry to ADMIN and MODERATOR', () => {
    const admin = SIDEBAR_NAV_ITEMS.find((i) => i.href === '/admin');
    expect(admin).toBeDefined();
    expect(admin?.roles).toEqual([UserRole.ADMIN, UserRole.MODERATOR]);
  });
});

describe('BOTTOM_NAV_ITEMS', () => {
  it('is not an alias of SIDEBAR_NAV_ITEMS and keeps the 7 non-restricted items', () => {
    expect(BOTTOM_NAV_ITEMS).not.toBe(SIDEBAR_NAV_ITEMS);
    expect(BOTTOM_NAV_ITEMS).toHaveLength(7);
  });

  it('does not inherit the sidebar-only Admin entry', () => {
    expect(BOTTOM_NAV_ITEMS.map((i) => i.href)).not.toContain('/admin');
  });
});

describe('getSidebarNavItems', () => {
  it('includes the Admin entry for an ADMIN', () => {
    const items = getSidebarNavItems(UserRole.ADMIN);
    expect(items).toHaveLength(8);
    expect(items.map((i) => i.href)).toContain('/admin');
  });

  it('includes the Admin entry for a MODERATOR', () => {
    const items = getSidebarNavItems(UserRole.MODERATOR);
    expect(items).toHaveLength(8);
    expect(items.map((i) => i.href)).toContain('/admin');
  });

  it('excludes the Admin entry for a MEMBER', () => {
    const items = getSidebarNavItems(UserRole.MEMBER);
    expect(items).toHaveLength(7);
    expect(items.map((i) => i.href)).not.toContain('/admin');
  });

  it('excludes role-restricted entries when no role is known', () => {
    expect(getSidebarNavItems()).toHaveLength(7);
    expect(getSidebarNavItems(null)).toHaveLength(7);
  });
});

describe('CATEGORY_CONFIG', () => {
  const requiredKeys = ['EVENT', 'UPDATE', 'GENERAL'] as const;

  it.each(requiredKeys)('%s exists in config', (key) => {
    expect(CATEGORY_CONFIG[key]).toBeDefined();
  });

  it.each(Object.entries(CATEGORY_CONFIG))(
    '%s has icon, iconBg, label, and badgeClass',
    (_key, config) => {
      expect(config.icon).toBeTruthy();
      expect(config.iconBg).toBeTruthy();
      expect(config.label).toBeTruthy();
      expect(config.badgeClass).toBeTruthy();
    },
  );
});

describe('getCategoryConfig', () => {
  it('returns the matching config for a known category', () => {
    expect(getCategoryConfig('EVENT')).toBe(CATEGORY_CONFIG.EVENT);
  });

  it('returns GENERAL for an unknown category', () => {
    expect(getCategoryConfig('UNKNOWN')).toBe(CATEGORY_CONFIG.GENERAL);
  });

  it('returns GENERAL for undefined', () => {
    expect(getCategoryConfig(undefined)).toBe(CATEGORY_CONFIG.GENERAL);
  });
});

describe('GROUP_CATEGORIES', () => {
  it('has at least one category', () => {
    expect(GROUP_CATEGORIES.length).toBeGreaterThan(0);
  });

  it.each(GROUP_CATEGORIES)('$label has key, label, and icon', (cat) => {
    expect(cat.key).toBeTruthy();
    expect(cat.label).toBeTruthy();
    expect(cat.icon).toBeTruthy();
  });
});

describe('QUICK_TRACK_CHAPTERS', () => {
  it('contains the expected chapters', () => {
    expect(QUICK_TRACK_CHAPTERS).toEqual(['Romans 12', 'Proverbs 12', 'Matthew 5']);
  });
});

describe('GROUP_METADATA', () => {
  it.each(Object.entries(GROUP_METADATA))(
    '%s has imageUrl, activityText, and timeLabel',
    (slug, meta) => {
      expect(meta.imageUrl).toBeTruthy();
      expect(typeof meta.activityText).toBe('function');
      expect(meta.timeLabel).toBeTruthy();
    },
  );
});

describe('getGroupMeta', () => {
  it('returns known metadata for a known slug', () => {
    expect(getGroupMeta('the-bereans', 'fallback')).toBe(GROUP_METADATA['the-bereans']);
  });

  it('returns fallback meta for an unknown slug', () => {
    const meta = getGroupMeta('unknown-slug', '5 minutes ago');
    expect(meta.timeLabel).toBe('5 minutes ago');
    expect(typeof meta.activityText).toBe('function');
  });

  it('fallback activityText pluralizes members', () => {
    const meta = getGroupMeta('unknown', '');
    expect(meta.activityText('g', 5)).toBe('5 members');
    expect(meta.activityText('g', 1)).toBe('1 member');
  });
});
