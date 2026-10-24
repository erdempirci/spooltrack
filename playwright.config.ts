import { defineConfig } from '@playwright/test';

// End-to-end test against the PRODUCTION build (npm run build first), served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    // Optional: point at an already installed Chrome/Chromium (CHROME_PATH=/path/to/chrome).
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
