import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log('Seeding database...');

  // Create admin user
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

  // Create sample groups
  const groups = await Promise.all([
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
  ]);

  // Add admin to first group
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: groups[0].id, userId: admin.id } },
    update: {},
    create: {
      groupId: groups[0].id,
      userId: admin.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });

  // Sample announcement
  await prisma.announcement.upsert({
    where: { id: 'seed-announcement-1' },
    update: {},
    create: {
      id: 'seed-announcement-1',
      title: 'Welcome to Transformlit!',
      body: 'Thank you for joining our community. Explore groups, connect with friends, and start reading together.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      createdById: admin.id,
      publishedById: admin.id,
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
