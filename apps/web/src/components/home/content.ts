export interface NavLink {
  label: string;
  href: string;
}

export interface Pillar {
  icon: string;
  title: string;
  description: string;
}

export interface Book {
  step: number;
  title: string;
  phase: string;
  description: string;
  coverClass: string;
  shopeeUrl: string;
}

export interface Announcement {
  date: string;
  title: string;
  excerpt: string;
}

export interface Partner {
  name: string;
}

export interface SocialLink {
  label: string;
  href: string;
  icon: string;
}

export const TAGLINE = 'Turning Pages, Turning Hearts.';

export const CONTACT = { email: 'hello@transformlit.com', phone: '0927-412-2292' };

export const FOOTER_SOCIALS: SocialLink[] = [
  { label: 'Facebook', href: 'https://facebook.com/transformlit', icon: 'facebook' },
  { label: 'Instagram', href: 'https://instagram.com/transformlit', icon: 'photo_camera' },
  {
    label: 'Google Play',
    href: 'https://play.google.com/store/apps/details?id=com.transformlit.app',
    icon: 'smartphone',
  },
  { label: 'Shopee', href: 'https://shopee.ph/transformlit', icon: 'shopping_bag' },
];

export const NAV_LINKS: NavLink[] = [
  { label: 'About', href: '#who-we-are' },
  { label: 'MOVE System', href: '#move-system' },
  { label: 'Books', href: '#move-system' },
  { label: 'Partners', href: '#partner-with-us' },
  { label: 'Contact', href: '#footer' },
];

export const PILLARS: Pillar[] = [
  {
    icon: 'diversity_3',
    title: 'Servant-Leadership Trainings',
    description:
      'Preparing the next generation through biblical servant-leadership formation.',
  },
  {
    icon: 'auto_stories',
    title: 'Moral-Recovery Literature',
    description:
      'Self-published, Biblically-sound books and curriculums for churches and small groups.',
  },
  {
    icon: 'psychology',
    title: 'Mental Health Empowerment',
    description:
      'Life coaching and community groups that restore hope and wellbeing.',
  },
];

export const BOOKS: Book[] = [
  {
    step: 1,
    title: 'Usbong',
    phase: 'Salvation',
    description: 'The beginning of new life in Christ.',
    coverClass: 'bg-primary-container',
    shopeeUrl: 'https://shopee.ph/product/70500775/13258169131',
  },
  {
    step: 2,
    title: 'Usad',
    phase: 'Spiritual Disciplines',
    description: 'Growing daily through the means of grace.',
    coverClass: 'bg-secondary-container',
    shopeeUrl: 'https://shopee.ph/product/70500775/14513651211',
  },
  {
    step: 3,
    title: 'Unlad',
    phase: 'Servant-Leadership',
    description: 'Leading others the way Christ leads.',
    coverClass: 'bg-primary-fixed-dim',
    shopeeUrl: 'https://shopee.ph/product/70500775/14857337751',
  },
  {
    step: 4,
    title: 'Ugnay',
    phase: 'Systematic Theology',
    description: 'Knowing God deeply — the Theologets Series.',
    coverClass: 'bg-tertiary-container',
    shopeeUrl: 'https://shopee.ph/product/70500775/21237049435',
  },
];

export const ANNOUNCEMENTS: Announcement[] = [
  {
    date: 'July 2026',
    title: 'Tahanan Registration — Open',
    excerpt:
      'Campus community registration is open. Partner campuses and students, sign up and join the journey.',
  },
  {
    date: 'August 2026',
    title: 'Book 4: Ugnay Now Available',
    excerpt:
      'The Theologets Series continues. Order Ugnay — and the full MOVE set — from the TransformLit Shopee store.',
  },
];

export const PARTNERS: Partner[] = [
  { name: 'Partner Church' },
  { name: 'Para-Church Ministry' },
  { name: 'Seminary' },
  { name: 'Christian School' },
  { name: 'Community Group' },
];