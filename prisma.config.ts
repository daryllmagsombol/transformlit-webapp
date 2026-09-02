import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  schema: 'apps/api/prisma/schema.prisma',
  migrations: {
    seed: 'tsx apps/api/prisma/seed.ts',
  },
});
