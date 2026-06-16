// Dynamic Expo config for app variants.
//
// Production and local dev use app.json exactly as-is. The STAGING build
// (EXPO_PUBLIC_APP_ENV=staging, set by the "staging" profile in eas.json) gets
// its own bundle identifier, Android package, display name, and URL scheme so
// it installs ALONGSIDE the App Store production app on the same device instead
// of colliding with it ("Euda is already installed").
//
// Expo passes the loaded app.json contents in as `config`; we return it
// unchanged unless this is a staging build.

module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_APP_ENV !== "staging") {
    return config; // production + local dev: identical to app.json
  }

  return {
    ...config,
    name: "Euda (Staging)",
    scheme: "euda-staging",
    ios: {
      ...config.ios,
      bundleIdentifier: "com.euda.app.staging",
    },
    android: {
      ...config.android,
      package: "com.euda.app.staging",
    },
  };
};
