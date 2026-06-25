// ── Announcement Category Config ────────────────────────────────────────────

type CategoryConfig = {
  icon: string;
  iconBg: string;
  label: string;
  badgeClass: string;
};

export const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  EVENT: {
    icon: 'event_available',
    iconBg: 'bg-secondary-container text-on-secondary-container',
    label: 'Event',
    badgeClass: 'bg-secondary-fixed text-on-secondary-fixed',
  },
  UPDATE: {
    icon: 'campaign',
    iconBg: 'bg-tertiary-container/30 text-tertiary',
    label: 'Update',
    badgeClass: 'bg-tertiary-fixed text-on-tertiary-fixed',
  },
  GENERAL: {
    icon: 'info',
    iconBg: 'bg-surface-container-high text-on-surface-variant',
    label: 'General',
    badgeClass: 'bg-outline-variant/50 text-on-surface-variant',
  },
};

export function getCategoryConfig(category?: string): CategoryConfig {
  return CATEGORY_CONFIG[category ?? ''] ?? CATEGORY_CONFIG.GENERAL;
}

// ── Group Metadata (mock / seed data) ───────────────────────────────────────

type GroupMeta = {
  imageUrl?: string;
  activityText: (name: string, memberCount: number) => string;
  timeLabel: string;
};

export const GROUP_METADATA: Record<string, GroupMeta> = {
  'the-bereans': {
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCPlHLTAhP434zlz74HTe0jjiH9C0d3Ix7-E9u8YSr9VH_PwfX_AzAsKwVsbU-5kLPCgJzS_Ijy18P5dbH5nqwq0crZyGY7PzD-ZVHv-d82TdO8jR_CjVEW-Lx82eMrhneCavEGWAneWFPasgUg_BvquGpy67I4N2jCi_wq6h9ynSfjmxMPS3Oe53sX5UNVaLeEz1CV6GpQLmg37RHmpLJNi2VgvP8D3ibc1t0s0FGonZu602MR6WMTf6n7jPlHc7kFXAjj6Sq4xZRe',
    activityText: () => 'discussed Acts 17 and shared 12 new reflections.',
    timeLabel: '15 minutes ago',
  },
  'morning-devotionals': {
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCiyNA6uERBu7LgkO3BM-5AMusjQdpPq1c7Y95zx3dseMAlSg6MlxZ6ORJvXc-VbKtAszVAzIZ4G__grklMP2VGF1PXd59P1k-fEuoG5YDgLzvSj-M73DF9jxan2fJTx4fpOHLUM6HYLeg8vDDch7TmNWUYqESUqFM3Rw02YyBUsywv4B1ej2EFHq_fQOp1eNashiz23nN_qgDVGuRYYiPfgya_8YgBBYyhpg9my9L0aHNfegVIaYjmFt1TmklACA12okyz5Dhlrd0g',
    activityText: () => 'completed their 50th consecutive day of reading!',
    timeLabel: '1 hour ago',
  },
  'seed-and-harvest': {
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBpZiy4idTFUVOuhZ_FBDWOlNje8w2ZT2kwdQQqD0zO4V81ERUIjsUV9kB1Lnk_CVCQ_cQ2H5r7mDhE6AQVi1DUmi3-ZFW8BKvq9zwq7_mcX5o7KRdsC1RCdrXuEW7h9nTbA3dIyF08OPFM4pY-sq_dnpmG8NtU-_Fc3m25E9Z2SBlC5KNGIagPGDhAEhD80fBNvaJOATSsjmMKjR5YNZ0_ItqGQXv0xQNODGWytqef7vNuzzxWbcp2b2PbHlDFOInDlR1MLz5gmrf3',
    activityText: () => 'welcomed 4 new members to the fellowship.',
    timeLabel: '3 hours ago',
  },
};

const DEFAULT_META: GroupMeta = {
  activityText: (_name, count) => `${count} member${count !== 1 ? 's' : ''}`,
  timeLabel: '',
};

export function getGroupMeta(slug: string, fallbackTimeLabel: string): GroupMeta {
  return GROUP_METADATA[slug] ?? { ...DEFAULT_META, timeLabel: fallbackTimeLabel };
}

// ── Quick Track Chapters ─────────────────────────────────────────────────────

export const QUICK_TRACK_CHAPTERS = ['Romans 12', 'Psalms 23', 'Matthew 5'];

// ── Navigation Items ─────────────────────────────────────────────────────────

export const SIDEBAR_NAV_ITEMS = [
  { label: 'Feed', href: '/feed', icon: 'dynamic_feed' },
  { label: 'Friends', href: '/friends', icon: 'group' },
  { label: 'Groups', href: '/groups', icon: 'diversity_3' },
  { label: 'Books', href: '/books', icon: 'menu_book' },
] as const;

export const BOTTOM_NAV_ITEMS = SIDEBAR_NAV_ITEMS;

// ── API Configuration ────────────────────────────────────────────────────────

/** REST API base URL (derived from the GraphQL endpoint by stripping /graphql) */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005/graphql'
).replace(/\/graphql$/, '');
