// Expo fingerprint config — controls the runtimeVersion (app.json runtimeVersion.policy
// = "fingerprint"). We skip the marketing-version fields from the hash so a
// `version` / `ios.buildNumber` / `android.versionCode` bump does NOT move the runtime
// and force a rebuild. Those fields don't change native compatibility, so an OTA can
// still reach an installed build across a version bump — keeping the OTA-first flow intact.
//
// SourceSkips.ExpoConfigVersions === 1 (see @expo/fingerprint). Adding this file changes
// the fingerprint ONCE (a one-time build); after that, version bumps are OTA-safe.
const { SourceSkips } = require("@expo/fingerprint");

module.exports = {
  sourceSkips: SourceSkips.ExpoConfigVersions,
};
