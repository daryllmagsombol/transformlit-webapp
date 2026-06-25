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
  const [generalDiscussion, bibleStudy, bereans, morningDevotionals, seedAndHarvest] =
    await Promise.all([
      prisma.group.upsert({
        where: { slug: 'general-discussion' },
        update: {},
        create: {
          name: 'General Discussion',
          slug: 'general-discussion',
          description: 'Chat about anything related to Transformlit books.',
          visibility: 'PUBLIC',
          createdById: admin.id,
        },
      }),
      prisma.group.upsert({
        where: { slug: 'bible-study' },
        update: {},
        create: {
          name: 'Bible Study',
          slug: 'bible-study',
          description: 'Weekly readings and discussions.',
          visibility: 'PUBLIC',
          createdById: admin.id,
        },
      }),
      prisma.group.upsert({
        where: { slug: 'the-bereans' },
        update: {},
        create: {
          name: 'The Bereans',
          slug: 'the-bereans',
          description:
            'A group dedicated to deep study of the Scriptures, examining each passage with care and curiosity.',
          visibility: 'PUBLIC',
          createdById: admin.id,
        },
      }),
      prisma.group.upsert({
        where: { slug: 'morning-devotionals' },
        update: {},
        create: {
          name: 'Morning Devotionals',
          slug: 'morning-devotionals',
          description:
            'Start each day with a short reading and reflection. All are welcome to join the morning rhythm.',
          visibility: 'PUBLIC',
          createdById: testUser.id,
        },
      }),
      prisma.group.upsert({
        where: { slug: 'seed-and-harvest' },
        update: {},
        create: {
          name: 'Seed & Harvest',
          slug: 'seed-and-harvest',
          description:
            'A fellowship focused on growth — planting seeds of faith and harvesting wisdom through shared reading.',
          visibility: 'PUBLIC',
          createdById: admin.id,
        },
      }),
    ]);

  // ── Group Memberships ───────────────────────────────────────────────────
  const allGroups = [generalDiscussion, bibleStudy, bereans, morningDevotionals, seedAndHarvest];

  // Admin is OWNER of all groups
  await Promise.all(
    allGroups.map((group) =>
      prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: admin.id } },
        update: {},
        create: {
          groupId: group.id,
          userId: admin.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      }),
    ),
  );

  // Test user is MEMBER of some groups
  await Promise.all(
    [bereans, morningDevotionals, seedAndHarvest].map((group) =>
      prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: testUser.id } },
        update: {},
        create: {
          groupId: group.id,
          userId: testUser.id,
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      }),
    ),
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

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
