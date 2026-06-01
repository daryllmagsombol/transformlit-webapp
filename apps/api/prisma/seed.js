const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'transformlit' },
    update: {},
    create: {
      name: 'Transformlit',
      slug: 'transformlit',
      status: 'active',
    },
  });

  const passwordHash = await argon2.hash('Transformlit123!');

  const admin = await prisma.user.upsert({
    where: {
      tenantId_emailNormalized: {
        tenantId: tenant.id,
        emailNormalized: 'admin@transformlit.local',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@transformlit.local',
      emailNormalized: 'admin@transformlit.local',
      passwordHash,
      status: 'active',
      role: 'tenant_admin',
    },
  });

  await prisma.profile.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: admin.id,
      displayName: 'Transformlit Admin',
      bio: 'Welcome to Transformlit.',
    },
  });

  const existingGroup = await prisma.group.findFirst({
    where: { tenantId: tenant.id, name: 'Founding Readers' },
  });

  const group =
    existingGroup ??
    (await prisma.group.create({
      data: {
        tenantId: tenant.id,
        name: 'Founding Readers',
        description: 'Our first community reading circle.',
        visibility: 'public',
      },
    }));

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: admin.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      groupId: group.id,
      userId: admin.id,
      role: 'owner',
      status: 'active',
    },
  });

  const announcementCount = await prisma.announcement.count({
    where: { tenantId: tenant.id },
  });

  if (announcementCount === 0) {
    await prisma.announcement.createMany({
      data: [
        {
          tenantId: tenant.id,
          title: 'Welcome to Transformlit',
          body: 'The reading lounge is open. Start by joining a group or inviting a friend.',
          status: 'published',
          publishAt: new Date(),
          publishedAt: new Date(),
          publishedById: admin.id,
        },
        {
          tenantId: tenant.id,
          title: 'Community guidelines',
          body: 'Respect, curiosity, and kindness keep our discussions alive.',
          status: 'published',
          publishAt: new Date(Date.now() + 3600 * 1000),
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          publishedAt: new Date(Date.now() + 3600 * 1000),
          publishedById: admin.id,
        },
      ],
    });
  }

  const existingDocument = await prisma.document.findFirst({
    where: { tenantId: tenant.id, title: 'Transformlit Sample Book' },
  });

  const document =
    existingDocument ??
    (await prisma.document.create({
      data: {
        tenantId: tenant.id,
        title: 'Transformlit Sample Book',
        description: 'Sample PDF for the MVP.',
        blobPath: 'samples/transformlit-sample.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024 * 1024,
        accessLevel: 'restricted',
      },
    }));

  await prisma.documentAccess.upsert({
    where: {
      documentId_userId: {
        documentId: document.id,
        userId: admin.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      documentId: document.id,
      userId: admin.id,
      accessType: 'read',
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
