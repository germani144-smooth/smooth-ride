import { defineConfig, devices } from "@playwright/test";

// Set CHROME_PATH to use an installed Chrome instead of Playwright's own Chromium.
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:4173/smooth-ride/", launchOptions },
  webServer: {
    command: "node tests/server.js",
    url: "http://localhost:4173/smooth-ride/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    // Android split screen under Google Maps: full width, short strip.
    {
      name: "split-screen",
      use: { ...devices["Pixel 7"], viewport: { width: 412, height: 300 } },
    },
  ],
});
