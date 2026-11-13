import { test, expect } from '@playwright/test';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES } from '../../src/shared/messages';
import libraryFixture from '../public/mock/libinstalled.json';
import boardFixture from '../public/mock/board_examples.json';
import projectStatus from '../public/mock/project_status.json';

const scenarios = [
  {
    view: 'Library Examples',
    route: '/library-examples',
    mockFile: 'libinstalled.json',
    library: libraryFixture.installed_libraries[0].library,
    installDir: '/home/developer/workspaces/shared maker projects/weather-station/sketchbook/libraries/NestedLibrary',
  },
  {
    view: 'Board Examples',
    route: '/board-examples',
    mockFile: 'board_examples.json',
    library: boardFixture.installed_libraries[0].library,
    installDir: '/home/developer/.arduino15/packages/espressif/hardware/esp32/3.3.2/libraries/NestedBoardLibrary',
  },
];

test.describe('example path labels', () => {
  test.use({ viewport: { width: 720, height: 700 } });

  for (const scenario of scenarios) {
    test(`${scenario.view} keeps nested POSIX examples readable and opens their original paths`, async ({ page }) => {
      const libraryName = 'Nested Example Paths';
      const paths = {
        i2c: `${scenario.installDir}/examples/Sensors/I2C/Read`,
        spi: `${scenario.installDir}/examples/Sensors/SPI/Read`,
        wifi: `${scenario.installDir}/examples/Networking/WiFi/Client`,
        blink: `${scenario.installDir}/examples/Blink`,
      };

      await page.route('**/mock/project_status.json', route => route.fulfill({
        json: { ...projectStatus, status: ARDUINO_ERRORS.NO_ERRORS },
      }));
      await page.route(`**/mock/${scenario.mockFile}`, route => route.fulfill({
        json: {
          installed_libraries: [{
            library: {
              ...scenario.library,
              name: libraryName,
              install_dir: scenario.installDir,
              source_dir: `${scenario.installDir}/src`,
              // Deliberately unsorted, with matching leaf names in different folders.
              examples: [paths.spi, paths.wifi, paths.blink, paths.i2c],
            },
          }],
        },
      }));

      // The existing browser development bridge emits outbound messages on window.
      // Observe that boundary without replacing the VS Code API or store behavior.
      await page.addInitScript(command => {
        const recordedWindow = window as typeof window & { __exampleOpenMessages: unknown[] };
        recordedWindow.__exampleOpenMessages = [];
        window.addEventListener('message', event => {
          if (event.source === window && event.origin === window.location.origin && event.data?.command === command) {
            recordedWindow.__exampleOpenMessages.push(event.data);
          }
        });
      }, ARDUINO_MESSAGES.OPEN_LIBRARY);

      await page.goto('/');
      await expect(page.getByTestId('board-name').locator('input').first()).toHaveValue('Arduino Uno');
      await page.locator(`a[href="${scenario.route}"]`).click();
      await expect(page.getByRole('main').getByText(scenario.view, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: libraryName, exact: true }).click();

      const panel = page.locator('.v-expansion-panel').filter({
        has: page.getByRole('button', { name: libraryName, exact: true }),
      });
      await expect(panel.locator('.v-list-subheader')).toHaveText(['Networking', 'Sensors']);
      await expect(panel.locator('.v-list-item-title')).toHaveText([
        'Blink', 'WiFi / Client', 'I2C / Read', 'SPI / Read',
      ]);

      const expectedMessages: { command: string; errorMessage: string; payload: string }[] = [];
      for (const example of [
        { title: 'I2C / Read', path: paths.i2c },
        { title: 'SPI / Read', path: paths.spi },
      ]) {
        const label = panel.getByText(example.title, { exact: true });
        await expect(label).toBeVisible();
        await label.hover();
        await expect(page.getByRole('tooltip').filter({ hasText: example.path })).toHaveText(example.path);

        await label.click();
        const row = panel.locator('.v-list-item').filter({ hasText: example.title });
        const open = row.getByRole('button', { name: 'Open', exact: true });
        await expect(open).toBeVisible();
        await expect(open).toBeInViewport();
        // Check the label still fits after the Open button consumes horizontal space.
        await expect.poll(() => label.evaluate(element => {
          const title = element.closest<HTMLElement>('.v-list-item-title');
          return title !== null && title.scrollWidth <= title.clientWidth + 1;
        })).toBe(true);

        await open.click();
        expectedMessages.push({ command: ARDUINO_MESSAGES.OPEN_LIBRARY, errorMessage: '', payload: example.path });
        await expect.poll(() => page.evaluate(() => {
          return (window as typeof window & { __exampleOpenMessages: unknown[] }).__exampleOpenMessages;
        })).toEqual(expectedMessages);
      }
    });
  }
});
