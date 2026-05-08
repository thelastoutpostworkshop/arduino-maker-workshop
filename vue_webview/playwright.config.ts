import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3347);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL,
  },
  webServer: {
    command: `npm run dev -- --host localhost --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
