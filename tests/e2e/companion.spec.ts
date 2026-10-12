import { test, expect, type Page } from '@playwright/test';
async function enter(page: Page) {
  await page.goto('/');
  const status = await (await page.request.get('/api/auth/status')).json();
  if (!status.initialized) {
    await page.getByLabel('Your name', { exact: true }).fill('Alex');
    await page
      .getByLabel('One-time setup token', { exact: true })
      .fill('isolated-e2e-only-setup-token-123456789');
  }
  await page.getByLabel('Email address', { exact: true }).fill('alex@example.test');
  await page.getByLabel('Password', { exact: true }).fill('isolated-test-only-password-123');
  await page
    .getByRole('button', {
      name: status.initialized ? 'Enter your space' : 'Create my private space',
    })
    .click();
  await expect(page.getByRole('heading', { name: /Good .*Alex/ })).toBeVisible();
  const saved = await (await page.request.get('/api/settings')).json();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    saved.settings.theme === 'dark' ? 'dark' : 'light',
  );
  if (saved.settings.theme === 'dark') {
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  }
}
async function nav(page: Page, name: string) {
  if (await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name, exact: true })
    .click();
}
test('private owner setup/login and complete persistent management journey', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enter(page);
  const title = 'Website checkout · ' + info.project.name;
  await nav(page, 'Projects');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Business website · ' + info.project.name);
  await page.getByLabel('Next action', { exact: true }).fill('Test payment integration');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Business website · ' + info.project.name }),
  ).toBeVisible();
  await nav(page, 'Tasks');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill(title);
  await page.getByLabel('Priority', { exact: true }).selectOption('high');
  await page
    .getByLabel('Project', { exact: true })
    .selectOption({ label: 'Business website · ' + info.project.name });
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('button', { name: new RegExp('^' + title.replace('·', '\\·')) }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete ' + title, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen ' + title, exact: true })).toBeVisible();
  await nav(page, 'Memory');
  await page.getByRole('button', { name: 'Add memory', exact: true }).click();
  await page
    .getByLabel('Memory', { exact: true })
    .fill('I prefer concise answers · ' + info.project.name);
  await page.getByLabel('Category', { exact: true }).selectOption('preferences');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByText('I prefer concise answers · ' + info.project.name, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('I prefer concise answers · ' + info.project.name, { exact: true }),
  ).toBeVisible();
  await page.getByText('I prefer concise answers · ' + info.project.name, { exact: true }).click();
  await page
    .getByLabel('Memory', { exact: true })
    .fill('I prefer direct, concise answers · ' + info.project.name);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('I prefer direct, concise answers · ' + info.project.name, { exact: true }),
  ).toBeVisible();
  await nav(page, 'Scheduling');
  await page.getByRole('button', { name: 'Schedule a check-in', exact: true }).click();
  await page
    .getByLabel('Check-in title', { exact: true })
    .fill('Morning planning · ' + info.project.name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByText('Morning planning · ' + info.project.name, { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: "Don't call again today", exact: true }).click();
  await expect(page.getByText(/Check-ins paused until/)).toBeVisible();
  await nav(page, 'Overview');
  await page.screenshot({
    path: '.data/screenshots/overview-' + info.project.name + '.png',
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('honest provider status, functional theme and keyboard search', async ({ page }, info) => {
  await enter(page);
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await nav(page, 'Conversation');
  await expect(page.getByText('Awaiting AI configuration', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review voice setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'System status', exact: true })).toBeVisible();
  await expect(page.getByText('No live verification', { exact: false })).toHaveCount(0);
  await expect(
    page.getByText('Live verification not recorded', { exact: true }).first(),
  ).toBeVisible();
  const existing = await (await page.request.get('/api/projects')).json();
  if (!existing.some((p: any) => p.name === 'Business website · ' + info.project.name)) {
    const me = await (await page.request.get('/api/auth/me')).json();
    await page.request.post('/api/projects', {
      headers: { 'x-csrf-token': me.csrf, origin: 'http://localhost:8081' },
      data: { name: 'Business website · ' + info.project.name },
    });
  }
  await page.getByRole('button', { name: 'Find anything', exact: false }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('website');
  await expect(
    page.getByRole('dialog').getByText('Business website · ' + info.project.name, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: '.data/screenshots/status-dark-' + info.project.name + '.png',
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('unauthenticated browser cannot retrieve or modify private records', async ({ page }) => {
  const get = await page.request.get('/api/memories');
  expect(get.status()).toBe(401);
  const post = await page.request.post('/api/tasks', { data: { title: 'Unauthorized task' } });
  expect(post.status()).toBe(401);
  await page.goto('/tasks');
  await expect(
    page.getByRole('button', { name: /^(Enter your space|Create my private space)$/ }),
  ).toBeVisible();
});

// Explicit MOCK permission/provider-response tests. These do not prove live microphone/audio service.
async function mockVoiceStatus(page: Page) {
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.live_ai_enabled = true;
    body.ai = { state: 'configured', detail: 'MOCK status for isolated lifecycle test only' };
    await route.fulfill({ response, json: body });
  });
}
test('MOCK delayed microphone permission cannot reopen voice after navigation', async ({
  page,
}) => {
  await mockVoiceStatus(page);
  await page.addInitScript(() => {
    const w = window as any;
    w.micStops = 0;
    w.peerCreations = 0;
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.peerCreations++;
      }
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise((resolve) => {
            w.releaseMicrophone = () =>
              resolve({ getTracks: () => [{ stop: () => w.micStops++ }] });
          }),
      },
    });
  });
  let starts = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/voice/session') && r.method() === 'POST') starts++;
  });
  await enter(page);
  await nav(page, 'Conversation');
  await page.getByRole('button', { name: 'Start a voice conversation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Allow your microphone.', exact: true }),
  ).toBeVisible();
  await nav(page, 'Overview');
  await page.evaluate(() => (window as any).releaseMicrophone());
  await expect.poll(() => page.evaluate(() => (window as any).micStops)).toBe(1);
  expect(await page.evaluate(() => (window as any).peerCreations)).toBe(0);
  expect(starts).toBe(0);
});
test('MOCK delayed provider creation is terminated instead of retried after cancellation', async ({
  page,
}) => {
  await mockVoiceStatus(page);
  await page.addInitScript(() => {
    const w = window as any;
    w.micStops = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const c = new AudioContext();
          w.syntheticContext = c;
          const stream = c.createMediaStreamDestination().stream;
          for (const t of stream.getTracks()) {
            const stop = t.stop.bind(t);
            t.stop = () => {
              w.micStops++;
              stop();
            };
          }
          return stream;
        },
      },
    });
  });
  const id = '00000000-0000-4000-8000-000000000001';
  let creation = false,
    ends = 0,
    release: () => void = () => {};
  await page.route('**/api/voice/session', async (route) => {
    creation = true;
    await new Promise<void>((r) => (release = r));
    await route.fulfill({
      json: {
        session_id: id,
        conversation_id: id,
        sdp: 'MOCK answer deliberately unused after cancellation',
        max_seconds: 30,
      },
    });
  });
  await page.route('**/api/voice/session/' + id + '/end', async (route) => {
    ends++;
    await route.fulfill({ json: { ended: true } });
  });
  await enter(page);
  await nav(page, 'Conversation');
  await page.getByRole('button', { name: 'Start a voice conversation', exact: true }).click();
  await expect.poll(() => creation).toBe(true);
  await nav(page, 'Overview');
  release();
  await expect.poll(() => ends).toBe(1);
  expect(await page.evaluate(() => (window as any).micStops)).toBe(1);
  await page.evaluate(() => (window as any).syntheticContext.close());
});
