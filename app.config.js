// The development build (dev client) gets its own bundle identifier and URL
// scheme so it can sit on a device next to the TestFlight build instead of
// replacing it. EAS sets APP_VARIANT from the build profile in eas.json.
const DEV_VARIANT = "dev";

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== DEV_VARIANT) {
    return config;
  }

  return {
    ...config,
    name: "OpenPad Dev",
    scheme: "openpad-dev",
    ios: {
      ...config.ios,
      bundleIdentifier: "lol.milio.openpad.dev",
    },
  };
};
