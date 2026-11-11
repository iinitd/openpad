# GitHub Actions → TestFlight

This workflow builds Puff **locally on a GitHub macOS runner** with `eas build --local`, then uploads the IPA to TestFlight. It does not consume the EAS cloud build quota; it consumes GitHub Actions minutes.

Workflow: `.github/workflows/ios-testflight.yml`

## Requirements

- Expo SDK 57 (Xcode 26.4+ required; the `macos-26` runner must ship Xcode 26.x).
- A paid Apple Developer Program membership, with the app's team in `app.json` (`expo.ios.appleTeamId`).
- An App Store Connect app record for `lol.milio.puff`, created with that bundle ID. The record's numeric app ID goes into `eas.json`.
- EAS build credentials configured for the `lol.milio.puff` bundle ID (distribution certificate + App Store provisioning profile).
- An Expo access token stored as the `EXPO_TOKEN` GitHub secret.
- The App Store Connect app ID in `eas.json` for non-interactive submission.

## 1. Add the Expo token

Create a token at:

```
https://expo.dev/settings/access-tokens
```

In GitHub → Settings → Secrets and variables → Actions, add:

```
EXPO_TOKEN
```

## 2. Configure EAS iOS credentials

Run once on a machine where you can complete Apple login/2FA:

```bash
npx eas-cli credentials -p ios
```

Set up:

- Distribution certificate
- App Store provisioning profile
- The correct Apple team (`CH854588A4` for this project) and the `lol.milio.puff` bundle ID

`eas build --local --non-interactive` reuses these credentials on the runner. Without them it will fail instead of prompting.

## 3. Add the App Store Connect app ID

Create the app record at App Store Connect if it does not exist, then copy the numeric app ID from the app's URL.

Edit `eas.json`:

```json
{
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID"
      }
    }
  }
}
```

`eas submit --non-interactive` needs this ID. It also needs App Store Connect API credentials; configure them with:

```bash
npx eas-cli submit -p ios
```

once interactively, or provide an App Store Connect API key.

## 4. Run the workflow

- GitHub → Actions → **iOS TestFlight** → Run workflow, or push a `v*` tag.
- The job checks out the repo, verifies Xcode, runs `npm ci`, builds/signs with `eas build --local`, uploads the IPA artifact, then submits it to TestFlight.
- The IPA remains available as the `puff-ipa` artifact even if submission fails.

## Xcode version

The workflow fails early if the runner has Xcode < 26. The `macos-26` image normally includes a supported Xcode. If GitHub's image is older, install/select a newer Xcode explicitly, for example:

```yaml
- uses: maxim-lobanov/setup-xcode@v1
  with:
    xcode-version: "26.4"
```

Downloading Xcode on the runner is large; prefer an image that already ships 26.4+.

## Limits

- GitHub public repository: macOS runner minutes are free.
- GitHub private repository Free plan: about 200 macOS minutes/month (2,000 minutes with the 10× macOS multiplier).
- TestFlight builds expire after 90 days; upload a new build before expiry.
- JS-only changes can go through EAS Update/xprem later without a native build.
