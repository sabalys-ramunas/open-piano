import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * Picks a free TCP port once, in the main process. Workers inherit the
 * environment, so they read the same port instead of picking another.
 */
function freePort(name: string): string {
  const known = process.env[name];
  if (known) return known;
  const port = execFileSync(process.execPath, [
    '-e',
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)))})",
  ])
    .toString()
    .trim();
  if (port === '5183') return freePort(name); // reserved for someone else's dev server
  process.env[name] = port;
  return port;
}

const devPort = freePort('E2E_DEV_PORT');
const previewPort = freePort('E2E_PREVIEW_PORT');

export default defineConfig({
  testDir: here,
  testMatch: /.*\.e2e\.ts$/,
  outputDir: resolve(root, 'test-results'),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: resolve(root, 'playwright-report'), open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${devPort}/`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    {
      name: 'dev',
      testIgnore: /offline\.e2e\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${devPort}/` },
    },
    {
      name: 'preview',
      testMatch: /offline\.e2e\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${previewPort}/` },
    },
    // Safari's engine. Opt in with E2E_WEBKIT=1 and --project=webkit.
    ...(process.env.E2E_WEBKIT
      ? [
          {
            name: 'webkit',
            testIgnore: /offline\.e2e\.ts$/,
            use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${devPort}/`, launchOptions: { args: [] } },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: `npx vite --port ${devPort} --strictPort --host 127.0.0.1`,
      env: { PIANO_E2E: '1' },
      cwd: root,
      url: `http://127.0.0.1:${devPort}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The offline tests need the real service worker, which only exists in a production build.
      command: `npx vite build --logLevel warn && npx vite preview --port ${previewPort} --strictPort --host 127.0.0.1`,
      cwd: root,
      url: `http://127.0.0.1:${previewPort}/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
