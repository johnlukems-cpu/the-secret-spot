import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests. Run against a running app:
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 * Flows that need data (checkout, admin) run only when E2E_LIVE=1 and the app is
 * connected to a seeded Supabase project (see TESTING.md).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "off" },
  projects: [
    // Device emulation runs in Chromium by default; set PW_WEBKIT=1 to use real WebKit for iOS presets.
    { name: "iphone", use: { ...devices["iPhone 13"], ...(process.env.PW_WEBKIT ? {} : { browserName: "chromium" as const }) } },
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], ...(process.env.PW_WEBKIT ? {} : { browserName: "chromium" as const }) } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
