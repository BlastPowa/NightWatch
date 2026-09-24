# NightWatch installer and product page

A self-contained, responsive Windows download page. Production needs only `index.html`, `styles.css`, `releases.js`, and `assets/nightwatch-mark.svg`. There is no build step, framework, external font, analytics, database, token, or paid service. App source, dependencies, release configuration, and workflows are unchanged by this page upgrade.

## Preview

From the NightWatch repository root:

```powershell
python -m http.server 4178 --bind 127.0.0.1 --directory docs/installer-site
```

Open [the local preview](http://127.0.0.1:4178/). Opening `index.html` directly also retains static download links; browser security rules may restrict live fetching or storage on `file://`.

The existing browser build also copies this directory to `/installer/` as a fallback route. The dedicated production site is the GitHub-connected Vercel project `night-watch-installer`, rooted at `docs/installer-site`, and is public at [night-watch-installer.vercel.app](https://night-watch-installer.vercel.app/). Keep Vercel's **Include source files outside of the Root Directory** option disabled for this project. The local `vercel.json` deliberately skips dependency installation and copies only the four production assets into `public/`, preventing the repository-level Vite/Electron configuration from leaking into this static deployment. Do not publish `tests/` or `.qa/`.

## Release integration

Read-only verification of `electron-builder.yml` and `.github/workflows/release.yml` established:

- Repository: [BlastPowa/NightWatch](https://github.com/BlastPowa/NightWatch).
- Builder artifact name: `NightWatch-Setup-${version}.${ext}`.
- Windows target: assisted NSIS, resulting in `NightWatch-Setup-<version>.exe`.
- Tags: `v*`; the manual Release workflow bumps the package version, creates a tag, and publishes through electron-builder.
- Published releases are public releases, not drafts. `.exe.blockmap` and `latest.yml` serve the desktop updater; they are not installer downloads.
- Verified live example on 2026-09-13: [v0.1.27](https://github.com/BlastPowa/NightWatch/releases/tag/v0.1.27), published 2026-07-21, containing `NightWatch-Setup-0.1.27.exe` (85,797,431 bytes).

The browser reads [GitHub's latest public release endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release):

```text
https://api.github.com/repos/BlastPowa/NightWatch/releases/latest
```

The request is unauthenticated and sends no cookies or referrer. It times out after eight seconds. Hosts with a restrictive Content Security Policy must permit `https://api.github.com` in `connect-src`, plus same-origin scripts, styles, and images. No external CDN is required.

### Download selection and safety

Both download buttons begin as ordinary links to [releases/latest](https://github.com/BlastPowa/NightWatch/releases/latest), so they work before JavaScript and when it is disabled. A successful response shows the version, UTC publication date, file size, and release notes.

A direct download is enabled only when the response contains an uploaded, nonempty asset named exactly `NightWatch-Setup-<version>.exe`, with its exact HTTPS URL under this repository and release tag. The page never assumes an installer exists merely because a tag exists. Wrong versions, blockmaps, incomplete uploads, unrelated repositories, URL query tricks, drafts, and prereleases cannot become installer links. A missing installer keeps `releases/latest` and explains the state.

Release notes support headings, paragraphs, and flat lists using text nodes. Raw HTML, remote images, and Markdown links are displayed as text, never executed or embedded. Notes are capped at 16,000 characters with a full-release link. A validated version-specific release link is used when present; otherwise it also falls back to `releases/latest`.

### Cache and recovery

`sessionStorage` key: `nightwatch:installer-release:v1`.

1. A valid response less than 15 minutes old is reused in the same tab, avoiding another API call.
2. Saved data between 15 minutes and 24 hours old can show immediately while refreshing. It is labelled as saved, and download buttons use `releases/latest` until a live installer is verified.
3. HTTP errors (including 403/429 rate limits and 404), network failures, invalid JSON, and timeouts retain usable cached information or restore the generic static page. No version is permanently hardcoded as “latest.”
4. Corrupt, future-dated, or older-than-24-hours cache entries are ignored. Both live and cached data pass the same asset/URL validation.
5. Blocked/full storage does not prevent live loading. The Refresh release button bypasses the cache, prevents concurrent requests, and recovers after failure.

The fallback preserves navigation when release details cannot load; downloading an installer still needs access to GitHub. There is no background polling or automatic retry loop.

## Design and content decisions

The page uses a dark cinema palette, lavender primary action, mint accents, shared spacing/radius/type tokens, a clearly labelled room illustration, and consistent local outline icons. The primary installer is visible in the desktop hero. On smaller screens it follows the introduction; the header offers a direct jump to it.

Accessibility includes a skip link, semantic landmarks and headings, native keyboard-operated disclosures, visible focus across interactive elements, a polite release-status announcement, responsive layouts, text enlargement, reduced-motion support, and stronger-contrast/forced-colors adaptations. The illustration contains no fake interactive controls. There are no continuously animated backgrounds or remote assets.

The [published v0.1.27 notes](https://github.com/BlastPowa/NightWatch/releases/tag/v0.1.27) say voice, live screen sharing, and synchronized shared-file room playback remain capability-gated. The copy directs users to release availability rather than promising these features are enabled. Installer guidance reflects the unsigned build configuration, replacing the old claim of a signed installer. The repository is now MIT licensed, so the site may accurately describe NightWatch as free and open-source software.

### Reference trail

These references informed original layout and interaction choices, without copying proprietary artwork, paid components, or source code. Observations were made from public pages on 2026-09-13. Suggestions are design interpretations, not claims that a reference supplied NightWatch code.

| Reference | Observed cue and application |
| --- | --- |
| [Refero Styles](https://styles.refero.design/) | Explicit color, typography, spacing, and component systems → shared CSS tokens and a consistent rhythm. |
| [designmd.me](https://designmd.me/) | Split action/preview hero → a focused download panel alongside the main message. |
| [Open Design](https://open-design.ai/) | Platform named inside the download action → explicit Windows labels and a download icon. |
| [designmd.supply](https://designmd.supply/) | Strong headline with contrasting emphasis → restrained accent treatment on “watch party.” |
| [getdesign.md](https://getdesign.md/) | Compact numbered rows with dividers → installation steps that scan quickly. |
| [Aura](https://aura.build/) | Spacious dark framing → subtle borders and depth around the download panel. |
| [Neuform](https://neuform.ai/) | Tall action panel beside previews → a compact installer surface with a larger product illustration below. |
| [Hyperbrowser Design MD](https://design-md.hyperbrowser.ai/) | Geometric outline icons and clear borders → one consistent local SVG icon vocabulary. |
| [Sokosumi Design MD](https://sokosumi.com/tools/design-md) | Nearby status and external specification link → release-source label beside notes and GitHub links. |
| [21st.dev](https://21st.dev/) | Brief headline entrance → a small, finite reveal that disables for reduced motion. |
| [Mobbin](https://mobbin.com/) | Filled primary and outlined secondary actions → clear download/action priority. Public marketing page only; no paid library copied. |
| [shadcn/ui](https://ui.shadcn.com/) | Accessible composable controls → native disclosures, keyboard focus, consistent button states; no React dependency added. |
| [Emil creator reference](https://skillsagentes.com/creators/emilk) | The supplied URL returned 404. Only its recovery links were observed; applied as clear GitHub fallback navigation, not attributed to Emil’s unavailable work. |
| [designmd.ai](https://designmd.ai/) | Fine selection framing → a restrained border around the focal product panel. |
| [Weekend Design MD](https://weekend.company/get-design-md) | Narrow, numbered process steps → concise three-step installation guidance. |
| [Tranmautritam](https://tranmautritam.com/) | Evenly spaced monochrome icons → restrained source/support link treatment. |
| [Astraform Creative](https://astraform-creative.aura.build/) | Public metadata describes a minimalist immersive agency template; full visual content was unavailable to the text fetch. Used that direction for spacing and subtle depth, without claiming to reproduce its WebGL or motion. |

## Local validation

The checks reuse the repository's existing `jsdom` and Electron dependencies. No packages were added. Run from the repository root:

```powershell
node --check docs/installer-site/releases.js
node --test docs/installer-site/tests/check-release.cjs
node node_modules/electron/cli.js docs/installer-site/tests/check-browser.cjs
git diff --check -- docs/installer-site
```

- `check-release.cjs`: 20 deterministic DOM/integration checks for static behavior, local assets, IDs/labels, live release rendering, cache freshness/expiry, manual refresh, offline/rate-limit failures, storage exceptions, upload/URL validation, hostile notes, invalid data, bounded notes, timeout recovery, and expired metadata cleanup.
- `check-browser.cjs`: a hidden Electron/Chromium renderer serves only the site's production files. It checks the actual GitHub response, image loading, keyboard focus/skip/disclosure interaction, widths of 320/390/768/1024/1440 pixels, 200% zoom and text, reduced motion, and renderer errors. This live check needs network access; a network failure is reported rather than counted as successful live integration. It never starts the NightWatch app or downloads/runs the installer.
- The browser check writes diagnostic screenshots and an isolated profile under ignored `.qa/`. These are local QA output only and should be removed before packaging this entire folder.

The checks deliberately use `check-*.cjs` names so NightWatch's app-level Vitest discovery does not pick up a separate Node test runner. App builds/tests are outside this page-only task.
