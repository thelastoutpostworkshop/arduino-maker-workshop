import { test, expect, type Page } from '@playwright/test';

const draft = 'Backtrace: 0x40081234:0x3ffb1000\nUnsaved crash log';
const disconnectedHeading = 'Extension connection lost';
const crashLogLabel = 'Paste ESP32 crash log from Serial Monitor';

type ConnectionTestWindow = Window & { heartbeatRequests: number };

async function heartbeat(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const delivered = (event: MessageEvent) => {
      if (event.data?.command !== 'extensionHeartbeat') return;
      window.removeEventListener('message', delivered);
      resolve();
    };
    window.addEventListener('message', delivered);
    window.postMessage({ command: 'extensionHeartbeat' }, window.location.origin);
  }));
}

async function activity(page: Page, hidden: boolean, focused: boolean, event: string) {
  await page.evaluate(({ hidden, focused, event }) => {
    Object.defineProperties(document, {
      hidden: { configurable: true, get: () => hidden },
      hasFocus: { configurable: true, value: () => focused },
    });
    (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
  }, { hidden, focused, event });
}

async function expectRequests(page: Page, count: number) {
  await expect.poll(() => page.evaluate(
    () => (window as ConnectionTestWindow).heartbeatRequests
  )).toBe(count);
}

test.describe('extension connection lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperties(document, {
        hidden: { configurable: true, get: () => false },
        hasFocus: { configurable: true, value: () => true },
      });
      (window as ConnectionTestWindow).heartbeatRequests = 0;
      window.addEventListener('message', (event) => {
        if (event.data?.command === 'webviewHeartbeatRequest') {
          (window as ConnectionTestWindow).heartbeatRequests++;
        }
      });
    });
    await page.goto('/');
    await page.getByTestId('nav-other-tools').click();
    await page.getByLabel(crashLogLabel).fill(draft);

    // Let the dev app finish its normal startup before controlling watchdog time.
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  });

  test('keeps the view connected when focus moves to Explorer', async ({ page }) => {
    // A standalone dev preview has no extension host to send heartbeats.
    await page.clock.runFor(60_000);
    await expect(page.getByRole('heading', { name: disconnectedHeading })).toBeHidden();
    await expectRequests(page, 0);

    await heartbeat(page);
    await activity(page, false, false, 'blur');
    await page.clock.runFor(60_000);
    await expect(page.getByLabel(crashLogLabel)).toBeVisible();
    await expectRequests(page, 0);

    await activity(page, false, true, 'focus');
    await expectRequests(page, 1);
    await page.clock.runFor(4_999);
    await expect(page.getByRole('heading', { name: disconnectedHeading })).toBeHidden();
    await heartbeat(page);
    await expect(page.getByLabel(crashLogLabel)).toHaveValue(draft);
  });

  test('allows a fresh heartbeat deadline after a hidden view returns', async ({ page }) => {
    await heartbeat(page);
    await activity(page, true, true, 'visibilitychange');
    await page.clock.runFor(60_000);
    await expect(page.getByRole('heading', { name: disconnectedHeading })).toBeHidden();
    await expectRequests(page, 0);

    await activity(page, false, true, 'visibilitychange');
    await expectRequests(page, 1);
    await page.clock.runFor(4_000);
    await expect(page.getByLabel(crashLogLabel)).toBeVisible();
    await heartbeat(page);
    await page.clock.runFor(4_999);
    await expectRequests(page, 1);
    await expect(page.getByLabel(crashLogLabel)).toHaveValue(draft);
  });

  test('probes after delayed timers and preserves drafts through a real disconnection', async ({ page }) => {
    await heartbeat(page);
    // Simulate a throttled or suspended renderer: overdue timers run only once.
    await page.clock.fastForward(60_000);
    await expectRequests(page, 1);
    await expect(page.getByLabel(crashLogLabel)).toBeVisible();
    await heartbeat(page);

    await page.clock.runFor(5_000);
    await expectRequests(page, 2);
    await page.clock.runFor(4_999);
    await expect(page.getByRole('heading', { name: disconnectedHeading })).toBeHidden();
    await page.clock.runFor(1);
    await expect(page.getByRole('heading', { name: disconnectedHeading })).toBeVisible();
    await expect(page.getByLabel(crashLogLabel)).toHaveCount(1);
    await expect(page.getByLabel(crashLogLabel)).toHaveValue(draft);
    await expect(page.getByLabel(crashLogLabel)).toBeHidden();

    await heartbeat(page);
    await expect(page.getByRole('heading', { name: disconnectedHeading })).toBeHidden();
    await expect(page.getByLabel(crashLogLabel)).toBeVisible();
    await expect(page.getByLabel(crashLogLabel)).toHaveValue(draft);
  });
});
