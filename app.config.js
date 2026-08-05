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
  // Inject the Mapbox config plugin. The SECRET download token is read from env
  // (MAPBOX_DOWNLOAD_TOKEN — an EAS secret / .env.local), never committed. The
  // public runtime token is EXPO_PUBLIC_MAPBOX_TOKEN.
  const base = {
    ...config,
    plugins: [
      ...(config.plugins || []),
      [
        "@rnmapbox/maps",
        { RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOAD_TOKEN || "" },
      ],
    ],
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
