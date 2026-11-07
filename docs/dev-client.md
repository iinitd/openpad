# iOS development build (dev client)

A development build is a native app that loads JavaScript from a Metro dev server instead of its embedded bundle. It gives hot reload, console logs, and the React Native debugger on a physical device, which neither TestFlight nor the web build can provide.

Unlike `production`, this build is distributed ad hoc, so it installs from a link or QR code without a cable, but only on devices registered to the Apple team.

Workflow: build with EAS, install from the QR code, run Metro.

## Requirements

- Expo SDK 57 (Xcode 26.4+; use EAS cloud or a `macos-26` GitHub runner, a local Xcode older than 26.4 cannot build it).
- Devices registered to the team before the build:
  ```bash
  npx eas-cli device:list --apple-team-id <TEAM_ID>
  ```
  Register a new device with `npx eas-cli device:create`; the owner opens the printed link on the phone and installs the profile.
- Ad Hoc credentials for the development bundle identifier (`lol.milio.openpad.dev`):
  ```bash
  npx eas-cli credentials -p ios
  ```

## Build

```bash
npx eas-cli build -p ios --profile development
```

The build finishes with an install link and QR code. Open it on the device and confirm the install.

One build covers every registered device; adding a device later requires a new build because the provisioning profile is baked into the IPA.

## Run against Metro

Start Metro on the machine that holds the source:

```bash
npx expo start --dev-client
```

The device and the machine must be able to reach each other. On the same Wi-Fi the printed URL works as is. Across networks, point the URL at an address the phone can route to:

```bash
EXPO_PACKAGER_HOSTNAME=<reachable-host> npx expo start --dev-client
```

If the QR code cannot be scanned across networks, enter `http://<reachable-host>:8081` manually from the dev client's launcher screen.

## Building on GitHub Actions

Workflow: `.github/workflows/ios-dev-client.yml`

Trigger it from Actions → **iOS Dev Client** → Run workflow. It runs `eas build --local` on a `macos-26` runner, so the build itself does not consume the EAS build quota; it uses GitHub Actions minutes, which are free for public repositories.

When the build succeeds, the job publishes the IPA and an `itms-services` manifest to the `gh-pages` branch. The run summary contains the install link.

One-time setup in the repository: **Settings → Pages → Source: Deploy from a branch → `gh-pages` / root**. The site is then `https://<owner>.github.io/<repo>/`.

The published site is public. The IPA can be downloaded by anyone, but an ad-hoc install only works on devices whose UDID is in the provisioning profile used for that build.

## Notes

- The development build uses its own bundle identifier, URL scheme, and display name, set by `app.config.js` when `APP_VARIANT=dev`. It can coexist with the TestFlight build instead of replacing it.
- Metro serves plain HTTP. iOS normally exempts only local network addresses from App Transport Security, and a Tailscale address (`100.64.0.0/10`) is not local, so the app declares `NSAllowsArbitraryLoads` in `app.json` for every build. Keep `NSAllowsLocalNetworking` out of that dictionary: on iOS 10 and later it makes the system ignore `NSAllowsArbitraryLoads` and fall back to local-network rules, which reject the tailnet address again. The same exception lets the app reach user-hosted OpenCode servers that have no TLS certificate. It is a native setting: changing it requires a new build.
- Dev-signed apps need Developer Mode enabled on the device (Settings → Privacy & Security → Developer Mode) and a reboot.
- The first connection asks for Local Network access. Denying it silently blocks Metro, and the permission has to be re-enabled in Settings.
- While Metro is the only JS source, keep the host machine awake; if it sleeps, the app loses its bundle and shows a blank screen or a spinner.
- A development build is not a release check. Signing, production bundling, and native behavior still need the TestFlight build.
