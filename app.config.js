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
  // Inject the Mapbox config plugin with NO options so this config is fully
  // deterministic — nothing here reads process.env. That matters because
  // runtimeVersion uses the fingerprint policy: any env-dependent value in the
  // Expo config (e.g. the old `RNMapboxMapsDownloadToken: process.env...`) makes
  // the fingerprint differ between the CI runner (no secret) and the EAS build
  // server (has the secret) → "runtime version mismatch" build failure.
  //
  // The SECRET download token is instead supplied to pod install / gradle via the
  // `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` environment variable (EAS secret / .env.local),
  // which the @rnmapbox/maps podspec + gradle read directly. The public runtime
  // token is EXPO_PUBLIC_MAPBOX_TOKEN.
  const base = {
    ...config,
    plugins: [...(config.plugins || []), "@rnmapbox/maps"],
  };

  if (process.env.EXPO_PUBLIC_APP_ENV !== "staging") {
    return base; // production + local dev
  }

  return {
    ...base,
    name: "Euda (Staging)",
    scheme: "euda-staging",
    ios: {
      ...base.ios,
      bundleIdentifier: "com.euda.app.staging",
    },
    android: {
      ...base.android,
      package: "com.euda.app.staging",
    },
  };
};
