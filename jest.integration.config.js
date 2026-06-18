/**
 * Integration test config — runs against the STAGING Supabase project.
 *
 * Distinct from jest.config.js (unit) because these tests:
 *   - run in a Node environment (they talk to Supabase over the network; no RN
 *     runtime is needed or wanted),
 *   - are slower and must not run in parallel against shared staging tables
 *     (maxWorkers: 1) to keep teardown deterministic,
 *   - need a generous per-test timeout for round-trips + edge cold starts.
 *
 * Transform reuses the repo's babel.config.js (babel-preset-expo handles TS),
 * the same toolchain the unit suite already uses — no new dependency.
 *
 * Run with: npm run test:integration
 */
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  testMatch: ["**/integration-tests/**/*.integration.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  maxWorkers: 1,
  testTimeout: 30000,
};
