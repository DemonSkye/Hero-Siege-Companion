const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.cjs/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/electron",
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
