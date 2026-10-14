import { defineConfig } from '@playwright/test';

const chromeArgs = [
  // Auto-accept capture prompts; the tab is chosen by title (see tests/e2e/helpers.ts).
  '--use-fake-ui-for-media-stream',
  '--auto-select-tab-capture-source-by-title=Fixture Music',
  // Loopback peers can't resolve mDNS host candidates in this sandbox.
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--autoplay-policy=user-gesture-required',
];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 150_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: chromeArgs, ignoreDefaultArgs: ['--mute-audio'] },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/peer-server.mjs --port 9417 --path /ts',
      port: 9417,
      reuseExistingServer: true,
      stdout: 'ignore',
    },
    {
      // Real playback tests run against the production build.
      command: 'npx vite build --logLevel warn && npx vite preview --port 4418 --strictPort',
      url: 'http://127.0.0.1:4418',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // Fixture-driven visual checks use the dev server, where fixtures exist.
      command: 'npx vite --port 4419 --strictPort',
      url: 'http://127.0.0.1:4419',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: 'audio', testMatch: /audio\/.*\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4418' } },
    { name: 'ui', testMatch: /ui\/.*\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4418' } },
    { name: 'visual', testMatch: /visual\/.*\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:4419' } },
  ],
});
