import { test as base, expect } from '@playwright/test';

type PwaFixture = { origin: 'https://localhost:3443' };

export const test = base.extend<PwaFixture>({
  origin: async ({ baseURL }, use) => {
    if (baseURL !== 'https://localhost:3443') throw new Error('PWA E2E requires the owned HTTPS harness origin');
    await use(baseURL);
  },
});

export { expect };
