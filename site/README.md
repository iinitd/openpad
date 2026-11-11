# Puff site

Static pages served by GitHub Pages from this folder. They back the App Store
listing's privacy policy and support URLs.

- `/` — landing
- `/privacy.html` — privacy policy
- `/support.html` — support

## Deploy

`.github/workflows/pages.yml` uploads this folder on every push to `main` that
touches `site/`, and can be run by hand from the Actions tab.

One-time setup in the repository: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. After that, the site is at:

```
https://iinitd.github.io/openpad/
```

That hostname is what `src/settings/about-links.ts` and the App Store Connect
fields should use. If the repository is renamed, both move and the two
constants need updating before the next build.

Pages serves the files as-is; `/privacy` without the extension is not a route,
so links keep the `.html` suffix and all asset paths are relative to this folder.
