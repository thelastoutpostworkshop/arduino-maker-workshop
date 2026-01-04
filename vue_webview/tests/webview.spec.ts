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

  test('shows board selection platforms from mock data', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-board-selection').click();
    await expect(
      page.getByRole('main').getByText('Board Selection', { exact: true })
    ).toBeVisible();

    await expect(
      page.getByTestId('board-selection-current-board').locator('input').first()
    ).toHaveValue('Arduino Uno');

    const rpPlatform = page.getByRole('button', {
      name: 'Raspberry Pi Pico/RP2040/RP2350 by Earle F. Philhower, III',
    });
    await expect(rpPlatform).toBeVisible();

    const esp32Platform = page.getByRole('button', {
      name: 'esp32 by Espressif Systems',
    });
    await expect(esp32Platform).toBeVisible();

    await rpPlatform.click();
    await expect(
      page.locator('a[href="https://github.com/earlephilhower/arduino-pico"]')
    ).toBeVisible();
  });

  test('shows boards manager statuses from mock data', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-board-manager').click();
    await expect(
      page.getByRole('main').getByText('Boards Manager', { exact: true })
    ).toBeVisible();

    const installedFilter = page.getByTestId('boards-filter-installed');
    const updatableFilter = page.getByTestId('boards-filter-updatable');
    const notInstalledFilter = page.getByTestId('boards-filter-not-installed');
    const deprecatedFilter = page.getByTestId('boards-filter-deprecated');
    const boardsTable = page.getByTestId('boards-table');

    await expect(installedFilter).toBeVisible();
    await expect(updatableFilter).toBeVisible();
    await expect(boardsTable.getByRole('cell', { name: 'Arduino AVR Boards' })).toBeVisible();
    await expect(updatableFilter.getByText(/\d+/)).toBeVisible();

    await updatableFilter.click();
    await expect(
      boardsTable.getByRole('cell', {
        name: 'Arduino SAMD Boards (32-bits ARM Cortex-M0+)',
      })
    ).toBeVisible();

    await notInstalledFilter.click();
    await expect(
      boardsTable.getByRole('cell', { name: 'Arduino ESP32 Boards' })
    ).toBeVisible();

    await deprecatedFilter.click();
    await expect(
      boardsTable.getByRole('cell', {
        name: '[DEPRECATED - Please install standalone packages] Arduino Mbed OS Boards',
      })
    ).toBeVisible();
  });

  test('shows library manager statuses from mock data', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('nav-library-manager').click();
    await expect(
      page.getByRole('main').getByText('Library Manager', { exact: true })
    ).toBeVisible();

    const installedFilter = page.getByTestId('libraries-filter-installed');
    const updatableFilter = page.getByTestId('libraries-filter-updatable');
    const notInstalledFilter = page.getByTestId('libraries-filter-not-installed');
    const deprecatedFilter = page.getByTestId('libraries-filter-deprecated');
    const librariesTable = page.getByTestId('libraries-table');

    await expect(installedFilter).toBeVisible();
    await expect(updatableFilter).toBeVisible();
    await expect(
      librariesTable.getByRole('cell', { name: 'Adafruit BusIO' })
    ).toBeVisible();
    await expect(updatableFilter.getByText(/\d+/)).toBeVisible();

    await updatableFilter.click();
    await expect(
      librariesTable.getByRole('cell', { name: 'Async TCP' })
    ).toBeVisible();

    await notInstalledFilter.click();
    await expect(
      librariesTable.getByRole('cell', { name: '107-Arduino-24LCxx' })
    ).toBeVisible();

    await deprecatedFilter.click();
    await expect(
      librariesTable.getByRole('cell', { name: 'Arduino_MachineControl' })
    ).toBeVisible();
  });
});
