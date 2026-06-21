module.exports = {
  preset: "jest-expo",
  // Integration tests live under integration-tests/ and run via
  // jest.integration.config.js against staging — keep them out of the fast unit run.
  testPathIgnorePatterns: ["/node_modules/", "/android/", "/ios/", "/integration-tests/"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
  ],
  setupFilesAfterEnv: [],
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
};
