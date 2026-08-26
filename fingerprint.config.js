// Expo fingerprint config — controls the runtimeVersion (app.json runtimeVersion.policy
// = "fingerprint"). We skip the marketing-version fields from the hash so a
// `version` / `ios.buildNumber` / `android.versionCode` bump does NOT move the runtime
// and force a rebuild. Those fields don't change native compatibility, so an OTA can
// still reach an installed build across a version bump — keeping the OTA-first flow intact.
//
// `sourceSkips: 1` === SourceSkips.ExpoConfigVersions in @expo/fingerprint. We use the
// raw bitmask value rather than `require("@expo/fingerprint")` on purpose: @expo/fingerprint
// is only a TRANSITIVE dep here (via expo/expo-updates, not in package.json), and requiring
// it inside this config crashed the EAS "Configure expo-updates" build phase (build #35).
// A plain number is a valid sourceSkips value and can't throw at config-load time.
//
// Adding this file changes the fingerprint ONCE (a one-time build); after that, version
// bumps are OTA-safe.
module.exports = {
  sourceSkips: 1,
};
