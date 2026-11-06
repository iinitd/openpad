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
      // The dev client reaches Metro over a Tailscale address (100.64.0.0/10),
      // which iOS does not treat as a local network, so the default ATS policy
      // rejects the plain HTTP dev server. Only the development variant opts
      // out; the production build keeps the secure default.
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSAllowsLocalNetworking: true,
        },
      },
    },
  };
};
