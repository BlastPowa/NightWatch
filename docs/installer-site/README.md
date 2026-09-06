# NightWatch installer and product page

This directory is a self-contained static concept for the public NightWatch download page. It is intentionally isolated from the Electron/React runtime and adds no package or runtime dependencies.

## Preview locally

Open `index.html` directly, or serve the repository root with any static file server and navigate to `/docs/installer-site/`.

For example:

```powershell
npx serve docs/installer-site
```

`npx serve` is only a local preview command; it is not added to NightWatch dependencies.

## Release integration

Every download call-to-action uses:

```text
https://github.com/BlastPowa/NightWatch/releases/latest
```

That stable URL automatically follows the newest published GitHub release, so the site does not need a commit for every version. The Releases page remains the source of truth for version notes, the installer, blockmap, and `latest.yml` updater metadata.

If a future deployment wants to display the exact version or direct installer asset, add a build-time script that reads the GitHub Releases API. Do not make an unauthenticated API request on every visitor page load because it can hit GitHub's public rate limit.

## Deployment options

The browser Vercel build also copies this folder to `/installer/`, so the
same deployment exposes the page at `/installer/` while `/` remains the
NightWatch browser app. It can still be deployed independently to GitHub
Pages, Vercel, Cloudflare Pages, or another static host by configuring the
host to publish this directory as its root.

## Design boundaries

- The visual direction adapts high-level cues from premium cloud-product sites: full-bleed depth, compact chrome, fluid cards, restrained glow, and clear download hierarchy.
- No Shadow branding, images, copy, code, or proprietary assets are included.
- The only included brand asset is NightWatch's existing SVG mark.
- The application illustration is built entirely with local HTML and CSS, so it remains lightweight and easy to theme.
- Motion respects `prefers-reduced-motion`.

## Before public launch

Replace or supplement the CSS-rendered application mockup with approved, current NightWatch screenshots; add the final privacy policy, terms, support contact, code-signing status, minimum system requirements, and installer checksum when available.
