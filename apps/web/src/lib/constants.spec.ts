import {
  CATEGORY_CONFIG,
  getCategoryConfig,
  GROUP_CATEGORIES,
  GROUP_METADATA,
  getGroupMeta,
  QUICK_TRACK_CHAPTERS,
  SIDEBAR_NAV_ITEMS,
  BOTTOM_NAV_ITEMS,
} from './constants';

describe('SIDEBAR_NAV_ITEMS', () => {
  it('has the expected number of items', () => {
    expect(SIDEBAR_NAV_ITEMS).toHaveLength(6);
  });

  it.each(SIDEBAR_NAV_ITEMS)('$label has label, href, and icon', (item) => {
    expect(item.label).toBeTruthy();
    expect(item.href).toMatch(/^\//);
    expect(item.icon).toBeTruthy();
  });

  it('contains Feed, Bible, Friends, Chat, Groups, and Books', () => {
    const labels = SIDEBAR_NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual(['Feed', 'Bible', 'Friends', 'Chat', 'Groups', 'Books']);
  });
});

describe('BOTTOM_NAV_ITEMS', () => {
  it('is the same as SIDEBAR_NAV_ITEMS', () => {
    expect(BOTTOM_NAV_ITEMS).toBe(SIDEBAR_NAV_ITEMS);
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
