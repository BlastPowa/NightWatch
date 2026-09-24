// Uses NightWatch's existing Electron/Chromium dependency as a hidden renderer.
// The app itself is never booted. All QA files stay under this site's .qa folder.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.qa');
fs.mkdirSync(qa, { recursive: true });
app.setPath('userData', path.join(qa, 'browser-profile'));
app.setPath('logs', path.join(qa, 'logs'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/releases.js', ['releases.js', 'text/javascript']],
  ['/assets/nightwatch-mark.svg', ['assets/nightwatch-mark.svg', 'image/svg+xml']],
]);
const server = http.createServer((req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(root, file[0])).pipe(res);
});
const errors = [];
let win;
const evaluate = (code) => win.webContents.executeJavaScript(code);
const paint = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  win = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, partition: 'nightwatch-installer-qa' } });
  win.webContents.on('console-message', (event, level, message) => { if (level >= 3) errors.push(message); });
  win.webContents.on('render-process-gone', (event, details) => errors.push(JSON.stringify(details)));
  await win.loadURL(url);
  await evaluate(`new Promise((resolve, reject) => {
    const button = document.getElementById('refresh-release');
    if (!button.disabled) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error('Release loading did not settle')), 12000);
    const observer = new MutationObserver(() => {
      if (!button.disabled) { observer.disconnect(); clearTimeout(timer); resolve(); }
    });
    observer.observe(button, { attributes: true });
  })`);
  await evaluate('Promise.all(document.getAnimations().map(animation => animation.finished))');
  const release = await evaluate(`({ version: document.querySelector('[data-release-version]').textContent,
    source: document.getElementById('release-source').textContent,
    download: document.querySelector('[data-download]').href,
    assetsLoaded: [...document.images].every(image => image.complete && image.naturalWidth > 0) })`);
  assert.ok(release.assetsLoaded, 'All local brand images should load');
  assert.equal(release.source, 'Latest from GitHub', 'Live GitHub request must succeed for this integration check');
  assert.match(release.download, /^https:\/\/github\.com\/BlastPowa\/NightWatch\/releases\/download\/v?\d+\.\d+\.\d+\/NightWatch-Setup-\d+\.\d+\.\d+\.exe$/);
  console.log('Live release:', JSON.stringify(release));

  // A hidden test window needs focus emulation for Chromium's :focus-visible.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });

  // Native focus traversal and Enter activation, without following download links.
  await evaluate('document.activeElement.blur(); window.scrollTo(0, 0)');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await paint();
  assert.ok(await evaluate("document.activeElement.matches('.skip-link')"), 'Tab should reach the skip link first');
  assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineWidth'), '3px');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await paint();
  assert.equal(await evaluate('document.activeElement.id'), 'main', 'Skip link must focus main content');
  await evaluate("document.querySelector('.help-items summary').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await paint();
  assert.ok(await evaluate("document.querySelector('.help-items details').open"), 'Keyboard must expand installation help');
  await evaluate("document.querySelector('.help-items details').open = false; document.activeElement.blur()");
  console.log('Keyboard: skip link, visible focus and native disclosure passed.');

  for (const width of [1440, 1024, 768, 390, 320]) {
    win.setContentSize(width, 1000);
    await paint();
    const size = await evaluate(`({ viewport: innerWidth, content: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('body *')].filter(node => {
        const box = node.getBoundingClientRect(); return box.width && (box.right > innerWidth + 1 || box.left < -1);
      }).slice(0, 5).map(node => node.className?.baseVal ?? node.className) })`);
    assert.ok(size.content <= size.viewport + 1, `Horizontal overflow at ${width}px: ${JSON.stringify(size)}`);
    if (width === 1440 || width === 390) {
      await evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
      await paint();
      fs.writeFileSync(path.join(qa, `preview-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    console.log(`Layout ${width}px: no horizontal overflow.`);
  }

  win.setContentSize(1280, 1000);
  win.webContents.setZoomFactor(2);
  await paint();
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), '200% zoom must reflow');
  win.webContents.setZoomFactor(1);
  await paint();
  await evaluate("document.documentElement.style.fontSize = '200%'");
  await paint();
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), '200% text must reflow');
  await evaluate("document.documentElement.style.fontSize = ''");
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.hero-copy')).animationName"), 'none');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).scrollBehavior'), 'auto');
  win.webContents.debugger.detach();
  console.log('Accessibility: 200% zoom/text and reduced motion passed.');
  assert.deepEqual(errors, [], 'Renderer must have no console errors');
  console.log('Renderer: no console errors. Screenshots:', qa);
  win.destroy();
  server.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  if (win && !win.isDestroyed()) win.destroy();
  server.close();
  app.exit(1);
});
