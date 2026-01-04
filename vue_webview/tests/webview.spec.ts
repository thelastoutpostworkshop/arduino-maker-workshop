import { test, expect } from '@playwright/test';

test.describe('webview dev server', () => {
  test('loads the home view with mock data', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByText('Arduino Maker Workshop', { exact: true })
    ).toBeVisible();

    await expect(page.getByTestId('cli-version')).toContainText(
      'Built-in CLI v1.0.4 (2024-08-12T13:42:36Z)'
    );

    await expect(
      page.getByTestId('board-name').locator('input').first()
    ).toHaveValue('Arduino Uno');

    await expect(
      page.getByTestId('upload-port').locator('input').first()
    ).toHaveValue('COM5');

    await expect(
      page.getByTestId('monitor-serial-port').locator('input').first()
    ).toHaveValue('COM5');

    await expect(
      page.getByTestId('monitor-baud-rate').locator('input').first()
    ).toHaveValue('9600');

    await expect(page.getByLabel('Use programmer')).toBeChecked();
    await expect(
      page.getByLabel('Optimize compile output for debugging, rather than for release')
    ).toBeChecked();
  });

  test('renders other tools and decodes a backtrace', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-other-tools').click();
    await expect(
      page.getByRole('main').getByText('Other Tools', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('ESP32 Partition Builder', { exact: true })
    ).toBeVisible();

    await page
      .getByLabel('Paste ESP32 crash log from Serial Monitor')
      .fill('Backtrace line 1\nBacktrace line 2');

    await page.getByRole('button', { name: 'Decode Backtrace' }).click();

    await expect(page.getByText('Decoded Frames', { exact: true })).toBeVisible();
    await expect(page.getByText('panic_abort')).toBeVisible();
  });
});
