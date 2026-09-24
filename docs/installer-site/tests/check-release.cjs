const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const script = readFileSync(path.join(root, 'releases.js'), 'utf8');
const latest = 'https://github.com/BlastPowa/NightWatch/releases/latest';
const cacheKey = 'nightwatch:installer-release:v1';
const minute = 60 * 1000;
const fixture = (overrides = {}) => ({
  tag_name: 'v1.2.3', draft: false, prerelease: false,
  published_at: '2026-09-01T00:15:00Z',
  html_url: 'https://github.com/BlastPowa/NightWatch/releases/tag/v1.2.3',
  body: '## Improvements\n- Better room recovery\n- Clearer settings\n\nSee you in the room.',
  assets: [{ name: 'NightWatch-Setup-1.2.3.exe', state: 'uploaded', size: 83886080,
    browser_download_url: 'https://github.com/BlastPowa/NightWatch/releases/download/v1.2.3/NightWatch-Setup-1.2.3.exe' }],
  ...overrides,
});
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const settle = () => new Promise((resolve) => setImmediate(resolve));

function page(t, options = {}) {
  const dom = new JSDOM(html, { url: 'https://nightwatch.test/installer/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  window.fetch = (...args) => { calls.push(args); return options.fetch ? options.fetch(...args) : Promise.resolve(ok(fixture())); };
  if (options.cache !== undefined) window.sessionStorage.setItem(cacheKey, typeof options.cache === 'string' ? options.cache : JSON.stringify(options.cache));
  if (options.blockStorage) Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
  if (options.fullStorage) window.Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
  if (options.fastTimeout) {
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, delay) => realSetTimeout(fn, delay === 8000 ? 5 : delay);
  }
  if (options.script !== false) window.eval(script);
  return { window, document: window.document, calls };
}
function assertDownloads(document, expected) {
  const links = [...document.querySelectorAll('[data-download]')];
  assert.equal(links.length, 2);
  for (const link of links) assert.equal(link.href, expected);
}
const status = (document) => document.getElementById('release-status').textContent;

test('static page works without JavaScript; local assets, fragment links, and labels resolve', (t) => {
  const { document } = page(t, { script: false });
  assertDownloads(document, latest);
  assert.equal(document.querySelector('#refresh-release').hidden, true);
  assert.equal(document.querySelectorAll('h1').length, 1);
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  for (const node of document.querySelectorAll('[href^="#"]')) assert.ok(document.getElementById(node.getAttribute('href').slice(1)), node.outerHTML);
  for (const node of document.querySelectorAll('[aria-labelledby], [aria-describedby]')) {
    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      for (const id of (node.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)) assert.ok(document.getElementById(id), id);
    }
  }
  for (const node of document.querySelectorAll('img[src],script[src],link[href]')) {
    const asset = node.getAttribute('src') || node.getAttribute('href');
    assert.ok(!/^https?:/.test(asset), 'Page assets must be local');
    assert.ok(existsSync(path.join(root, asset)), asset);
  }
  for (const node of document.querySelectorAll('img')) assert.ok(node.hasAttribute('alt'));
  assert.equal(document.querySelectorAll('[aria-hidden="true"] button, [aria-hidden="true"] a').length, 0);
});

test('live GitHub response fills version, UTC date, size, notes and exact direct installer', async (t) => {
  const { document, calls, window } = page(t);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://api.github.com/repos/BlastPowa/NightWatch/releases/latest');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(document.querySelector('[data-release-version]').textContent, 'v1.2.3');
  assert.match(document.querySelector('[data-release-date]').textContent, /1 Sept? 2026/);
  assert.equal(document.querySelector('[data-release-date]').getAttribute('datetime'), '2026-09-01T00:15:00.000Z');
  assert.equal(document.querySelector('[data-release-size]').textContent, '80.0 MB · .exe');
  assert.equal(document.querySelectorAll('#release-notes li').length, 2);
  assertDownloads(document, fixture().assets[0].browser_download_url);
  assert.equal(document.querySelector('[data-release-link]').href, fixture().html_url);
  assert.match(status(document), /up to date/);
  assert.ok(window.sessionStorage.getItem(cacheKey));
});

test('fresh session cache avoids another API call; manual refresh obtains a new release', async (t) => {
  const { document, calls } = page(t, { cache: { savedAt: Date.now() - minute, release: fixture() }, fetch: async () => ok(fixture({ tag_name: 'v1.2.4', assets: [] })) });
  assert.equal(calls.length, 0);
  assertDownloads(document, fixture().assets[0].browser_download_url);
  assert.match(status(document), /last 15 minutes/);
  document.querySelector('#refresh-release').click();
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(document.querySelector('[data-release-version]').textContent, 'v1.2.4');
  assertDownloads(document, latest);
});

test('stale cached metadata is labelled and never offers a stale direct installer during an outage', async (t) => {
  const { document, calls } = page(t, { cache: { savedAt: Date.now() - 16 * minute, release: fixture() }, fetch: async () => { throw new Error('offline'); } });
  assertDownloads(document, latest);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(document.querySelector('[data-release-version]').textContent, 'v1.2.3');
  assertDownloads(document, latest);
  assert.match(status(document), /saved.*may have changed/);
});

for (const [label, cached] of [
  ['expired', { savedAt: Date.now() - 25 * 60 * minute, release: fixture() }],
  ['future-dated', { savedAt: Date.now() + 60 * minute, release: fixture() }],
  ['invalid timestamp', { savedAt: 'yesterday', release: fixture() }],
  ['corrupt JSON', '{broken'],
  ['wrong shape', { savedAt: Date.now(), release: { tag_name: 'surprise' } }],
]) {
  test(`${label} cache is discarded without preventing static fallback`, async (t) => {
    const { document, calls } = page(t, { cache: cached, fetch: async () => ({ ok: false, status: 403 }) });
    await settle();
    assert.equal(calls.length, 1);
    assertDownloads(document, latest);
    assert.equal(document.querySelector('[data-release-version]').textContent, 'Latest public release');
    assert.match(status(document), /unavailable/);
  });
}

for (const statusCode of [403, 404, 429, 500]) {
  test(`HTTP ${statusCode} keeps both GitHub fallback links usable`, async (t) => {
    const { document } = page(t, { fetch: async () => ({ ok: false, status: statusCode }) });
    await settle();
    assertDownloads(document, latest);
    assert.match(status(document), /unavailable/);
    assert.equal(document.querySelector('#refresh-release').disabled, false);
  });
}

test('blocked or full sessionStorage does not break live release loading', async (t) => {
  for (const setting of ['blockStorage', 'fullStorage']) {
    const { document } = page(t, { [setting]: true });
    await settle();
    assertDownloads(document, fixture().assets[0].browser_download_url);
    assert.match(status(document), /up to date/);
  }
});

test('missing, wrong-version, unfinished, empty, blockmap, and unsafe assets never become downloads', async (t) => {
  const asset = fixture().assets[0];
  const cases = [[], [null], [{ ...asset, name: 'NightWatch-Setup-1.2.2.exe' }],
    [{ ...asset, name: 'NightWatch-Setup-1.2.3.exe.blockmap' }], [{ ...asset, state: 'starter' }],
    [{ ...asset, size: 0 }], [{ ...asset, browser_download_url: 'https://github.com.evil.test/installer.exe' }],
    [{ ...asset, browser_download_url: 'javascript:alert(1)' }],
    [{ ...asset, browser_download_url: asset.browser_download_url.replace('BlastPowa', 'somebody-else') }],
    [{ ...asset, browser_download_url: `${asset.browser_download_url}?redirect=evil` }]];
  for (const assets of cases) {
    const { document } = page(t, { fetch: async () => ok(fixture({ assets })) });
    await settle();
    assertDownloads(document, latest);
    assert.match(status(document), /not attached yet/);
  }
});

test('release HTML is literal text; untrusted release links and cached URLs cannot execute', async (t) => {
  const body = '## <img src=x onerror=alert(1)>\n- <script>alert(1)</script>\n\n[join](javascript:alert(1))';
  const release = fixture({ body, html_url: 'javascript:alert(1)', assets: [{ ...fixture().assets[0], browser_download_url: 'https://evil.test/setup.exe' }] });
  const { document, calls } = page(t, { cache: { savedAt: Date.now(), release } });
  assert.equal(calls.length, 0);
  assert.equal(document.querySelectorAll('#release-notes img, #release-notes script, #release-notes a').length, 0);
  assert.match(document.querySelector('#release-notes').textContent, /<script>alert/);
  assert.equal(document.querySelector('[data-release-link]').href, latest);
  assertDownloads(document, latest);
});

test('malformed JSON, drafts, prereleases and unexpected tag formats use static fallback', async (t) => {
  const cases = [null, {}, fixture({ draft: true }), fixture({ prerelease: true }), fixture({ tag_name: '../../unsafe' }), fixture({ tag_name: 'v1.2.3-rc.1' })];
  for (const payload of cases) {
    const { document } = page(t, { fetch: async () => ok(payload) });
    await settle();
    assertDownloads(document, latest);
    assert.match(status(document), /unavailable/);
  }
  const { document } = page(t, { fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }) });
  await settle();
  assertDownloads(document, latest);
});

test('unknown date and empty notes have readable fallbacks; long notes are bounded', async (t) => {
  const first = page(t, { fetch: async () => ok(fixture({ published_at: 'not-a-date', body: null })) });
  await settle();
  assert.equal(first.document.querySelector('[data-release-date]').hasAttribute('datetime'), false);
  assert.match(first.document.querySelector('#release-notes').textContent, /No release notes/);
  const second = page(t, { fetch: async () => ok(fixture({ body: 'x'.repeat(18000) })) });
  await settle();
  const notes = second.document.querySelector('#release-notes').textContent;
  assert.ok(notes.length < 16200);
  assert.match(notes, /shortened/);
});

test('timeout aborts the request, restores refresh and permits recovery without overlapping requests', async (t) => {
  let signal;
  const { document, calls } = page(t, { fastTimeout: true, fetch: (url, options) => new Promise((resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  assert.equal(document.querySelector('#refresh-release').disabled, true);
  document.querySelector('#refresh-release').click();
  assert.equal(calls.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal.aborted, true);
  assertDownloads(document, latest);
  assert.equal(document.querySelector('#refresh-release').disabled, false);
  assert.equal(document.querySelector('#refresh-release').hasAttribute('aria-busy'), false);
});

test('a failed refresh clears metadata after the session cache expires', async (t) => {
  const { document, window } = page(t, { cache: { savedAt: Date.now(), release: fixture() }, fetch: async () => { throw new Error('offline'); } });
  window.sessionStorage.clear();
  document.querySelector('#refresh-release').click();
  await settle();
  assert.equal(document.querySelector('[data-release-version]').textContent, 'Latest public release');
  assert.equal(document.querySelector('[data-release-date]').hasAttribute('datetime'), false);
  assertDownloads(document, latest);
});
