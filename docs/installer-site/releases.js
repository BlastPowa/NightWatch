/* Progressive enhancement: every download already works before this script runs. */
(() => {
  'use strict';

  const repository = 'https://github.com/BlastPowa/NightWatch';
  const latestUrl = `${repository}/releases/latest`;
  const apiUrl = 'https://api.github.com/repos/BlastPowa/NightWatch/releases/latest';
  const cacheKey = 'nightwatch:installer-release:v1';
  const freshFor = 15 * 60 * 1000;
  const usableFor = 24 * 60 * 60 * 1000;
  const requestTimeout = 8000;
  const maxNotesLength = 16000;
  const refreshButton = document.getElementById('refresh-release');
  const status = document.getElementById('release-status');
  const source = document.getElementById('release-source');
  const fallbackNodes = [...document.querySelectorAll('[data-release-version], [data-release-date], [data-release-size], #release-title, #release-notes')]
    .map((node) => ({ node, content: [...node.childNodes].map((child) => child.cloneNode(true)) }));
  let pending = false;

  // Validate live and cached responses alike. A tag alone never implies an asset.
  function normalizeRelease(value) {
    if (!value || value.draft !== false || value.prerelease !== false) return null;
    const tag = typeof value.tag_name === 'string' ? value.tag_name : '';
    const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag);
    if (!match || tag.length > 64) return null;
    const version = match[1];
    const assetName = `NightWatch-Setup-${version}.exe`;
    const expectedUrl = `${repository}/releases/download/${tag}/${assetName}`;
    const asset = Array.isArray(value.assets) ? value.assets.find((item) => (
      item && item.name === assetName && item.state === 'uploaded'
      && item.browser_download_url === expectedUrl
      && Number.isSafeInteger(item.size) && item.size > 0
    )) : null;
    const published = typeof value.published_at === 'string' ? Date.parse(value.published_at) : NaN;
    const notes = typeof value.body === 'string' ? value.body : '';
    const releaseUrl = `${repository}/releases/tag/${tag}`;
    return {
      version,
      published: Number.isFinite(published) ? new Date(published).toISOString() : null,
      url: value.html_url === releaseUrl ? releaseUrl : latestUrl,
      asset: asset ? { name: assetName, url: expectedUrl, size: asset.size } : null,
      notes: notes.slice(0, maxNotesLength),
      truncated: notes.length > maxNotesLength,
    };
  }

  function readCache() {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw || raw.length > 100000) return null;
      const cached = JSON.parse(raw);
      const age = Date.now() - cached.savedAt;
      if (!Number.isFinite(cached.savedAt) || age < 0 || age >= usableFor) return null;
      const release = normalizeRelease(cached.release);
      return release ? { release, age } : null;
    } catch {
      // Storage can be blocked, corrupt, or unavailable on file://.
      return null;
    }
  }

  function saveCache(raw) {
    try {
      // Persist only the public fields used by this page.
      const release = {
        tag_name: raw.tag_name, draft: raw.draft, prerelease: raw.prerelease,
        html_url: raw.html_url, published_at: raw.published_at,
        body: typeof raw.body === 'string' ? raw.body.slice(0, maxNotesLength + 1) : '',
        assets: Array.isArray(raw.assets) ? raw.assets.filter((asset) => (
          asset && asset.name === `NightWatch-Setup-${raw.tag_name.replace(/^v/, '')}.exe`
        )).map(({ name, state, size, browser_download_url }) => ({ name, state, size, browser_download_url })) : [],
      };
      sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), release }));
    } catch {
      // Live data is still usable if storage is disabled or full.
    }
  }

  function appendText(parent, tag, content) {
    const element = document.createElement(tag);
    element.textContent = content;
    parent.append(element);
    return element;
  }

  function renderNotes(release) {
    const container = document.getElementById('release-notes');
    container.replaceChildren();
    if (!release.notes.trim()) {
      appendText(container, 'p', 'No release notes were included. Open the full release on GitHub for its files and details.');
      return;
    }
    // A text-only Markdown subset: HTML, images, scripts and URLs in release
    // notes never become executable markup, embeds or untrusted links.
    let list = null;
    let paragraph = null;
    for (const line of release.notes.split(/\r?\n/)) {
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (!line.trim() || heading) {
        list = null;
        paragraph = null;
        if (heading) appendText(container, 'h4', heading[1]);
      } else if (bullet || numbered) {
        const tag = bullet ? 'UL' : 'OL';
        if (!list || list.tagName !== tag) list = appendText(container, tag.toLowerCase(), '');
        appendText(list, 'li', (bullet || numbered)[1]);
        paragraph = null;
      } else {
        list = null;
        if (!paragraph) paragraph = appendText(container, 'p', line);
        else paragraph.append(document.createTextNode(` ${line}`));
      }
    }
    if (release.truncated) appendText(container, 'p', 'These notes are shortened. Read the full release on GitHub for everything that changed.');
  }

  function setDownloads(release, allowDirect) {
    const asset = allowDirect ? release?.asset : null;
    document.querySelectorAll('[data-download]').forEach((link) => {
      link.href = asset ? asset.url : latestUrl;
      link.querySelector('[data-download-label]').textContent = asset ? 'Download for Windows' : 'Get Windows installer';
      link.setAttribute('aria-describedby', 'download-help');
    });
    document.getElementById('download-help').textContent = asset
      ? `Direct from GitHub · ${asset.name}`
      : 'Choose the NightWatch Setup .exe on GitHub Releases.';
  }

  function renderRelease(release, allowDirect) {
    document.querySelectorAll('[data-release-version]').forEach((node) => { node.textContent = `v${release.version}`; });
    document.querySelectorAll('[data-release-date]').forEach((node) => {
      if (release.published) {
        node.dateTime = release.published;
        node.textContent = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(release.published));
      } else {
        node.removeAttribute('datetime');
        node.textContent = 'See GitHub for date';
      }
    });
    document.querySelectorAll('[data-release-size]').forEach((node) => {
      node.textContent = release.asset ? `${(release.asset.size / 1024 / 1024).toFixed(1)} MB · .exe` : 'See release assets';
    });
    document.querySelectorAll('[data-release-link]').forEach((link) => { link.href = release.url; });
    document.getElementById('release-title').textContent = `NightWatch ${release.version}`;
    renderNotes(release);
    setDownloads(release, allowDirect);
  }

  function renderFallback() {
    for (const { node, content } of fallbackNodes) {
      node.replaceChildren(...content.map((child) => child.cloneNode(true)));
      node.removeAttribute('datetime');
    }
    document.querySelectorAll('[data-release-link]').forEach((link) => { link.href = latestUrl; });
    setDownloads(null, false);
  }

  async function loadRelease(force = false) {
    if (pending) return;
    const cached = readCache();
    if (cached) {
      const fresh = cached.age < freshFor;
      renderRelease(cached.release, fresh);
      source.textContent = 'Saved in this tab';
      status.textContent = fresh
        ? 'Showing release details checked in this tab within the last 15 minutes.'
        : 'Showing saved release details while checking GitHub for an update.';
      if (fresh && !force) return;
    }

    pending = true;
    refreshButton.disabled = true;
    refreshButton.setAttribute('aria-busy', 'true');
    status.textContent = cached ? 'Checking GitHub for an update to the saved release…' : 'Checking the latest public GitHub release…';
    let timeout;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), requestTimeout);
      const response = await fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github+json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Release request failed: ${response.status}`);
      const raw = await response.json();
      const release = normalizeRelease(raw);
      if (!release) throw new Error('Invalid public release response');
      renderRelease(release, true);
      source.textContent = 'Latest from GitHub';
      status.textContent = release.asset
        ? 'Release details are up to date. The Windows download links to the installer attached to this release.'
        : 'Release details are up to date. A matching Windows installer is not attached yet; open GitHub for available downloads.';
      saveCache(raw);
    } catch {
      // A cache expiring during the timeout must not become a fresh installer.
      const fallback = readCache();
      if (fallback) {
        renderRelease(fallback.release, fallback.age < freshFor);
        source.textContent = 'Saved in this tab';
        status.textContent = 'GitHub could not be reached. Showing saved release details; they may have changed. The full release link opens GitHub.';
      } else {
        renderFallback();
        source.textContent = 'GitHub Releases';
        status.textContent = 'Release details are unavailable right now. You can still open the latest release on GitHub, or try refreshing.';
      }
    } finally {
      clearTimeout(timeout);
      pending = false;
      refreshButton.disabled = false;
      refreshButton.removeAttribute('aria-busy');
    }
  }

  refreshButton.hidden = false;
  refreshButton.addEventListener('click', () => { void loadRelease(true); });
  void loadRelease();
})();
