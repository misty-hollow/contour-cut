import { defineConfig, devices } from '@playwright/test';

// 실행 검증: 프로덕션 빌드를 vite preview로 띄우고 실제 키보드·마우스로 조작한다.
// 테스트마다 새 브라우저 컨텍스트. 로컬에서 받아 둔 chromium이 없으면 E2E_CHANNEL=msedge.
const channel = process.env.E2E_CHANNEL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: 'test-results/pw',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, ...(channel ? { channel } : {}) } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
