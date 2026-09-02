import { test, expect, Page, BrowserContext } from '@playwright/test';

const ADMIN_EMAIL = 'admin@transformlit.com';
const ADMIN_PASSWORD = 'Transformlit123!';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);
}

async function registerFriend(
  context: BrowserContext,
  email: string,
  displayName: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/register');
  await page.getByLabel('Full Name').fill(displayName);
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  // Exact match: the social buttons' accessible names ("Register with …")
  // also match the brief's /create account|register|sign up/i regex.
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await expect(page).toHaveURL(/.*\/feed/);
  return page;
}

test.describe('Chat flow', () => {
  test('friend request → accept → DM both ways with realtime reply', async ({ browser }) => {
    // Unique per-run identity: the dev DB persists across runs, so the
    // admin's requests/friends lists accumulate buddies from earlier runs.
    const stamp = Date.now();
    const email = `buddy${stamp}@example.com`;
    const buddyName = `Chat Buddy ${stamp}`;

    const adminCtx = await browser.newContext();
    const buddyCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Buddy registers and sends admin a friend request.
    const buddyPage = await registerFriend(buddyCtx, email, buddyName);
    await buddyPage.goto('/friends');
    await buddyPage.getByPlaceholder('Search users...').fill(ADMIN_EMAIL);
    // Search results have no "Add Friend" button — clicking a result row
    // opens the user profile sheet, which holds the action buttons.
    await buddyPage.getByText('Admin', { exact: true }).click();
    const buddySheet = buddyPage.getByRole('dialog');
    await expect(buddySheet).toBeVisible({ timeout: 10000 });
    await buddySheet.getByRole('button', { name: 'Add Friend' }).click();
    await expect(buddyPage.getByText(/friend request sent/i)).toBeVisible({ timeout: 10000 });

    // Admin accepts the *specific* buddy's request (older pending requests
    // from previous runs may exist, so scope by the unique display name).
    await adminPage.goto('/friends');
    const buddyRequestCard = adminPage
      .getByText(buddyName, { exact: true })
      .first()
      .locator('xpath=ancestor::div[.//button[normalize-space()="Accept"]][1]');
    await buddyRequestCard.getByRole('button', { name: 'Accept' }).click({ timeout: 10000 });

    // Admin opens the buddy's profile from the friends list and starts a DM.
    // FriendCard renders as a <button> whose accessible name contains the
    // display name — clicking by role avoids stale request cards.
    await adminPage.getByRole('button', { name: new RegExp(buddyName) }).click();
    await adminPage.getByRole('button', { name: /view full profile/i }).click();
    await expect(adminPage).toHaveURL(/\/users\//);
    await adminPage.getByRole('button', { name: /message/i }).click();
    await expect(adminPage).toHaveURL(/\/chat\//);
    await adminPage.getByPlaceholder('Type a message…').fill('Hello from admin!');
    await adminPage.getByPlaceholder('Type a message…').press('Enter');
    // Scope to the thread <section>: the conversation-list aside previews of
    // older conversations (persisted between runs) can also contain the text.
    await expect(adminPage.locator('section').getByText('Hello from admin!')).toBeVisible();

    // Buddy sees the conversation (title uses the admin's display name),
    // opens it, and replies.
    await buddyPage.goto('/chat');
    // The /chat list page renders a mobile (md:hidden) copy of the list plus the
    // desktop aside copy; `.first()` targets the visible aside.
    await expect(
      buddyPage.getByText(ADMIN_EMAIL).or(buddyPage.getByText('Admin')).first(),
    ).toBeVisible({ timeout: 10000 });
    await buddyPage.getByText('Hello from admin!').first().click();
    await buddyPage.getByPlaceholder('Type a message…').fill('Hello back!');
    await buddyPage.getByPlaceholder('Type a message…').press('Enter');
    await expect(buddyPage.locator('section').getByText('Hello back!')).toBeVisible();

    // Admin sees the reply in realtime (no reload) — scoped to the thread
    // <section> so stale conversation previews cannot satisfy the assertion.
    await expect(adminPage.locator('section').getByText('Hello back!')).toBeVisible({ timeout: 10000 });

    await adminCtx.close();
    await buddyCtx.close();
  });

  test('bottom nav fits six items at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/chat');
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(nav).toBeVisible();
    const links = nav.locator('a');
    await expect(links).toHaveCount(6);
    // no horizontal overflow
    const overflow = await nav.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
  });
});