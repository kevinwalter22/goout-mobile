module.exports = function (api) {
  api.cache(true);

  const plugins = [];

  // Strip console.log/warn/info in production builds.
  // console.error is kept so Sentry beforeBreadcrumb can still capture it.
  if (process.env.NODE_ENV === "production") {
    plugins.push([
      "transform-remove-console",
      { exclude: ["error"] },
    ]);
  }

  return {
    presets: ["babel-preset-expo"],
    plugins,
  };
};
