import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log('Seeding database...');

  // ── Admin user ──────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { emailNormalized: 'admin@transformlit.com' },
    update: {},
    create: {
      email: 'admin@transformlit.com',
      emailNormalized: 'admin@transformlit.com',
      displayName: 'Admin',
      role: 'ADMIN',
      // password: "Transformlit123!" hashed via argon2
      passwordHash:
        '$argon2id$v=19$m=65536,t=3,p=4$placeholder.....' +
        'REPLACE_WITH_REAL_HASH',
    },
  });

  // ── Test user ───────────────────────────────────────────────────────────
  const testUser = await prisma.user.upsert({
    where: { emailNormalized: 'sarah@transformlit.com' },
    update: {},
    create: {
      email: 'sarah@transformlit.com',
      emailNormalized: 'sarah@transformlit.com',
      displayName: 'Sarah M.',
      role: 'MEMBER',
      passwordHash:
        '$argon2id$v=19$m=65536,t=3,p=4$placeholder.....' +
        'REPLACE_WITH_REAL_HASH',
    },
  });

  // ── Groups ──────────────────────────────────────────────────────────────
  const groupsData = [
    {
      slug: 'the-bereans',
      name: 'Theology Explorers',
      description:
        'A deep dive into historical texts and contemporary reflections on faith and philosophy.',
      category: 'BIBLICAL_STUDIES' as const,
      featured: true,
      coverImageUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuBNxmlkAmF2cbw5LvYJQeVR5zrCYY5Up1zewQmigBCdJtQ8ps7DULxDFOkUMOcL65FiDT5CPQjNDfRJkfalOWo2yPSYqXgiZ4_Qe11P2LNDinLQph8lwAyPESrb-hPHQP1bkVGcVkB_a1PzZiE2_c6FCtgzRZ8zP686JsYhBrGxsf_n5oEvMX6Ucm0DyyG7C7va-nK56SEYyzAKSSWicmD38Z4xVs5r8PjgMI1H56BeVeWSGk9CyLQYRZKGpnXKWykPTazbxktVrs7P',
    },
    {
      slug: 'morning-devotionals',
      name: 'Morning Readers',
      description:
        "Starting the day with inspiration and collective wisdom. Currently reading: 'The Alchemist'.",
      category: 'BIBLICAL_STUDIES' as const,
      featured: false,
      coverImageUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuA-0Zdwh9cQcg0U2XmF7toIwaw_4UQ-S_6B2j7NM1tRfZSA1qYNVw15RFhnfrRn75msZlHOnmybvMjGZ7qSbLcNYEEzaDGow3F1-uSof2onhqgJbJ0naIfT7zyyePCtWxVoCGTdUWKSzioiYZPd7__36lv-NBL9Nwgl-H7Be1wqW6z_CPz5WKoOINATWCmInOJuZSJcuPscOGTVuw8i5Ar-C18TBo4qjUFyJYj3f_RjTqwLimmNDVDC1lBy9O2dLrGRDOWq1Rbx6102',
    },
    {
      slug: 'modern-fiction-circle',
      name: 'Modern Fiction Circle',
      description:
        'Dissecting the latest bestsellers and uncovering hidden gems in the world of contemporary prose.',
      category: 'MODERN_FICTION' as const,
      featured: false,
      coverImageUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuDnOqKhb4d4cB1B-k6fTa0EWuF2ePXAaqWna0LHVPsLEUJt7t97Ky-eaAg68VLadiCqymXvFvOrLrk70cdkA4_Myg7hLNGUW2L5Pb4JUXeu0ZMOXQa2zuYtUpE_6ArV8RzsSnWFgpgMFlkgvWsDfG1ZZ5ZdIcD3RD5vRa3UlS0SMSbTikQh0mB7qq7JimnJku-5xLiGzP_tiMGpcWLgRosvFzn6RRqpDRYAOi0TJeqMbDAGheg95DSzywL_krjW7pjD_9Azr7Ci04_x',
    },
    {
      slug: 'historical-memoirs',
      name: 'Historical Memoirs',
      description:
        'Explore the lives of those who shaped history through their own words.',
      category: 'HISTORICAL' as const,
      featured: true,
      coverImageUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuBkykph_NM-OXNgIKulAk4GkVNVyWuPFtMk57hXmJdhzPcqnMxEGVoh1KSdA7HvXJmsbQiS64BUKSW66Kce7SxmZjSqvlN5ecPx-A_LzQujKxJBL-1-fMQcv3dmYO1c5X3ymX0DyT-6T9awpYGrL0AEfG2m0s4A31m2af_4lpImWBW0pfm2l03dSND7G3D1YzC28Mv1GKWF-crY_TY7qOk5lM1Al3G84poTb5eC8Lyd_LiUa-v2ot_IX5q3fzJKndXyuweCi6NHG-Dw',
    },
    {
      slug: 'global-wisdom',
      name: 'Global Wisdom',
      description: 'Comparative Religion Circle — exploring wisdom traditions from around the world.',
      category: 'PHILOSOPHY' as const,
      featured: false,
    },
    {
      slug: 'art-and-soul',
      name: 'Art & Soul',
      description: 'Creative Writing & Poetry — where words become art and stories find their voice.',
      category: 'YOUNG_ADULT' as const,
      featured: false,
    },
    {
      slug: 'nature-voice',
      name: "Nature's Voice",
      description: 'Environmental Literature — reading the world through the lens of nature and ecology.',
      category: 'MODERN_FICTION' as const,
      featured: false,
    },
  ];

  // Create all groups
  const createdGroups = await Promise.all(
    groupsData.map((g) =>
      prisma.group.upsert({
        where: { slug: g.slug },
        update: {},
        create: {
          slug: g.slug,
          name: g.name,
          description: g.description,
          visibility: 'PUBLIC',
          category: g.category,
          coverImageUrl: g.coverImageUrl ?? null,
          featured: g.featured,
          createdById: admin.id,
        },
      }),
    ),
  );

  // ── Fake users for realistic member counts ────────────────────────────────
  const fakeUsers = await Promise.all(
    [
      { email: 'elijah@transformlit.com', displayName: 'Elijah R.' },
      { email: 'priya@transformlit.com', displayName: 'Priya K.' },
      { email: 'marcus@transformlit.com', displayName: 'Marcus J.' },
      { email: 'lucia@transformlit.com', displayName: 'Lucia M.' },
      { email: 'thomas@transformlit.com', displayName: 'Thomas A.' },
      { email: 'fatima@transformlit.com', displayName: 'Fatima S.' },
      { email: 'james@transformlit.com', displayName: 'James W.' },
      { email: 'emma@transformlit.com', displayName: 'Emma L.' },
      { email: 'david@transformlit.com', displayName: 'David C.' },
      { email: 'sophia@transformlit.com', displayName: 'Sophia N.' },
    ].map((u) =>
      prisma.user.upsert({
        where: { emailNormalized: u.email },
        update: {},
        create: { email: u.email, emailNormalized: u.email, displayName: u.displayName, role: 'MEMBER' },
      }),
    ),
  );

  // ── Group Memberships ───────────────────────────────────────────────────
  // Admin is OWNER of all groups
  await Promise.all(
    createdGroups.map((group) =>
      prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: admin.id } },
        update: {},
        create: { groupId: group.id, userId: admin.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    ),
  );

  // Test user + fake users as MEMBER of specific groups
  const membershipMap: Record<string, string[]> = {
    'the-bereans': [testUser.id, ...fakeUsers.slice(0, 6).map((u) => u.id)],
    'morning-devotionals': [testUser.id, ...fakeUsers.slice(0, 3).map((u) => u.id)],
    'modern-fiction-circle': [...fakeUsers.slice(2, 8).map((u) => u.id)],
    'historical-memoirs': [...fakeUsers.slice(4, 7).map((u) => u.id)],
    'global-wisdom': [...fakeUsers.slice(1, 4).map((u) => u.id)],
    'art-and-soul': [...fakeUsers.slice(0, 2).map((u) => u.id)],
    'nature-voice': [...fakeUsers.slice(5, 7).map((u) => u.id)],
  };

  await Promise.all(
    Object.entries(membershipMap).flatMap(([slug, userIds]) => {
      const group = createdGroups.find((g) => g.slug === slug);
      if (!group) return [];
      return userIds.map((userId) =>
        prisma.groupMember.upsert({
          where: { groupId_userId: { groupId: group.id, userId } },
          update: {},
          create: { groupId: group.id, userId, role: 'MEMBER', status: 'ACTIVE' },
        }),
      );
    }),
  );

  // ── Announcements ───────────────────────────────────────────────────────
  await Promise.all([
    prisma.announcement.upsert({
      where: { id: 'seed-announcement-1' },
      update: {},
      create: {
        id: 'seed-announcement-1',
        title: 'Welcome to Transformlit!',
        body: 'Thank you for joining our community. Explore groups, connect with friends, and start reading together.',
        status: 'PUBLISHED',
        category: 'GENERAL',
        publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        createdById: admin.id,
        publishedById: admin.id,
      },
    }),
    prisma.announcement.upsert({
      where: { id: 'seed-announcement-2' },
      update: {},
      create: {
        id: 'seed-announcement-2',
        title: 'New community reading challenge starting Monday!',
        body: 'Join over 500 members as we embark on a 30-day journey through the Epistles. Special discussion prompts will be released daily.',
        status: 'PUBLISHED',
        category: 'EVENT',
        publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        createdById: admin.id,
        publishedById: admin.id,
      },
    }),
    prisma.announcement.upsert({
      where: { id: 'seed-announcement-3' },
      update: {},
      create: {
        id: 'seed-announcement-3',
        title: 'Updated Mobile Navigation & Library Sync',
        body: "We've refined the mobile experience to make tracking your daily reading smoother. Check out the new progress widget in your sidebar.",
        status: 'PUBLISHED',
        category: 'UPDATE',
        publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        createdById: admin.id,
        publishedById: admin.id,
      },
    }),
  ]);

  // ── Verse of the Day ────────────────────────────────────────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await prisma.verseOfTheDay.upsert({
    where: { date: today },
    update: {},
    create: {
      date: today,
      text: '"The heart of man plans his way, but the Lord establishes his steps."',
      reference: 'Proverbs 16:9',
      version: 'ESV',
    },
  });

  // ── Books ───────────────────────────────────────────────────────────────
  const booksData = [
    {
      id: 'seed-book-usbong',
      title: 'Book 1: Usbong',
      subtitle: 'Salvation',
      description:
        'Usbong! Ito ang unang installment ng lessons para sa ating MOVE DISCIPLESHIP PROGRAM at pag-aaralan natin dito ang basic elements ng Christian faith. Puwede mo itong magamit sa iyong personal Bible study o sa inyong Small Group Bible Study.',
      coverUrl:
        'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=600&q=80',
      totalPages: 120,
    },
    {
      id: 'seed-book-usad',
      title: 'Book 2: Usad',
      subtitle: 'Spiritual Disciplines',
      description:
        'Madaling magsimula, mahirap magpatuloy. Hindi sapat para sa isang mananampalataya ang mag-umpisa lang; kailangan nating UMUSAD. Kaya nga china-challenge tayo ng Bible na "Buong tiyaga tayong tumakbo sa takbuhing nasa ating harapan" (Hebrews 12:1). Kailangan ng tiyaga, disiplina at biyaya ng Dios para umusad.',
      coverUrl:
        'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=600&q=80',
      totalPages: 140,
    },
    {
      id: 'seed-book-unlad',
      title: 'Book 3: Unlad',
      subtitle: 'Servant-Leadership',
      description:
        "Hindi lahat ng umuusbong ay umuusad. Maraming nagsisimula pero hindi naman nagpapatuloy. Hindi rin naman lahat ng umuusad ay umuulad; mayroong mga nagpapatuloy pero patawing-tawing lang na naglalakbay. Mga mananampalatayang nauna, pero nahuli; tumagal, pero 'di tumugon sa panawagan na maglingkod at manguna. Stagnant.",
      coverUrl:
        'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=600&q=80',
      totalPages: 160,
    },
    {
      id: 'seed-book-ugnay',
      title: 'Book 4: Ugnay',
      subtitle: 'Systematic Theology',
      description:
        'Systematic Theology: Theologets Series composed of 7 sub-books covering the 7 main branches of Theology.',
      coverUrl:
        'https://images.unsplash.com/photo-1507842217121-9e962835d771?auto=format&fit=crop&w=600&q=80',
      totalPages: 280,
    },
  ];

  await Promise.all(
    booksData.map((book) =>
      prisma.book.upsert({
        where: { id: book.id },
        update: {},
        create: {
          id: book.id,
          title: book.title,
          description: `${book.subtitle}\n\n${book.description}`,
          coverUrl: book.coverUrl,
          accessLevel: 'FREE',
          status: 'PUBLISHED',
          totalPages: book.totalPages,
          createdById: admin.id,
          publishedAt: new Date(),
        },
      }),
    ),
  );

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
