export interface StartupSplashState {
  label: string;
  detail: string;
  progress: number;
}

export const STARTUP_SPLASH_STAGES = {
  starting: {
    label: 'Opening NightWatch',
    detail: 'Starting the cinema',
    progress: 12,
  },
  restoring: {
    label: 'Opening NightWatch',
    detail: 'Restoring your session',
    progress: 38,
  },
  connecting: {
    label: 'Opening NightWatch',
    detail: 'Connecting rooms and media',
    progress: 70,
  },
  preparing: {
    label: 'Opening NightWatch',
    detail: 'Preparing your screen',
    progress: 88,
  },
  ready: {
    label: 'NightWatch is ready',
    detail: 'Tonight is better together',
    progress: 100,
  },
  degraded: {
    label: 'Opening NightWatch',
    detail: 'Continuing in offline-ready mode',
    progress: 100,
  },
  updateInstalling: {
    label: 'Updating NightWatch',
    detail: 'Preparing the new version',
    progress: 18,
  },
  updateFinishing: {
    label: 'Updating NightWatch',
    detail: 'Finishing installation and restoring your screen',
    progress: 76,
  },
  updateReady: {
    label: 'NightWatch is updated',
    detail: 'Starting the new version',
    progress: 100,
  },
} as const satisfies Record<string, StartupSplashState>;

export function buildStartupSplashUpdateScript(state: StartupSplashState): string {
  const safeState: StartupSplashState = {
    label: state.label.slice(0, 80),
    detail: state.detail.slice(0, 120),
    progress: Math.max(0, Math.min(100, Math.round(state.progress))),
  };
  return `window.nightwatchSplash?.update(${JSON.stringify(safeState)})`;
}

/**
 * Self-contained so the splash can paint before Vite/React or the app://
 * protocol is ready. It never loads scripts, fonts, images, or styles from the
 * network.
 */
export function buildStartupSplashHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
  <title>Opening NightWatch</title>
  <style>
    :root { color-scheme: dark; --accent: #59e8ce; --accent-2: #6d7cff; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      display: grid;
      place-items: center;
      color: #f5f7ff;
      font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      background: transparent;
      user-select: none;
    }
    .splash {
      position: relative;
      display: grid;
      width: 500px;
      min-height: 310px;
      place-items: center;
      align-content: center;
      gap: 18px;
      padding: 30px 42px 28px;
      overflow: hidden;
      border: 1px solid rgba(112, 235, 215, .28);
      border-radius: 30px;
      background:
        radial-gradient(320px 190px at 50% 28%, rgba(72, 207, 203, .15), transparent 70%),
        linear-gradient(150deg, rgba(17, 24, 43, .99), rgba(5, 8, 18, .995));
      box-shadow: 0 32px 90px rgba(0, 0, 0, .62), inset 0 1px rgba(255,255,255,.07);
    }
    .splash::before {
      position: absolute;
      inset: -55% -20%;
      background: conic-gradient(from 90deg, transparent, rgba(78, 219, 203, .09), transparent 24%, rgba(109,124,255,.1), transparent 54%);
      content: "";
      animation: atmosphere 8s linear infinite;
    }
    .loader {
      position: relative;
      display: grid;
      width: 126px;
      height: 126px;
      place-items: center;
      isolation: isolate;
    }
    .orbit, .orbit::before, .orbit::after {
      position: absolute;
      inset: 0;
      border: 2px solid transparent;
      border-top-color: var(--accent);
      border-right-color: rgba(109, 124, 255, .42);
      border-radius: 50%;
      content: "";
      filter: drop-shadow(0 0 7px rgba(89, 232, 206, .55));
      animation: orbit 1.8s cubic-bezier(.55,.12,.35,.9) infinite;
    }
    .orbit::before { inset: 10px; animation-duration: 1.35s; animation-direction: reverse; opacity: .7; }
    .orbit::after { inset: 21px; border-width: 1px; animation-duration: 2.4s; opacity: .5; }
    .mark {
      position: relative;
      width: 68px;
      height: 68px;
      filter: drop-shadow(0 0 16px rgba(89,232,206,.35));
    }
    .moon { fill: none; stroke: url(#moon-gradient); stroke-width: 6; stroke-linecap: round; }
    .play { fill: rgba(4,10,19,.7); stroke: var(--accent); stroke-width: 4; stroke-linejoin: round; }
    .copy { position: relative; display: grid; gap: 4px; text-align: center; }
    h1 { margin: 0; font-size: 25px; letter-spacing: -.045em; }
    p { margin: 0; color: #9ca8c2; font-size: 13px; }
    .progress-shell { position: relative; display: grid; width: 100%; gap: 8px; }
    .progress-meta { display: flex; justify-content: space-between; color: #8995ae; font-size: 11px; }
    .progress-track {
      height: 8px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 999px;
      background: rgba(255,255,255,.07);
      box-shadow: inset 0 2px 5px rgba(0,0,0,.42);
    }
    .progress-fill {
      position: relative;
      width: 12%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent-2), var(--accent), #c4fff5);
      box-shadow: 0 0 18px rgba(89,232,206,.6);
      transition: width 420ms cubic-bezier(.2,.85,.25,1);
    }
    .progress-fill::after {
      position: absolute;
      top: 50%; right: 0;
      width: 13px; height: 13px;
      border-radius: 50%;
      background: #ddfff9;
      box-shadow: 0 0 15px var(--accent);
      content: "";
      transform: translate(20%, -50%);
    }
    .hint { position: relative; color: #66728b; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
    @keyframes orbit { to { transform: rotate(360deg); } }
    @keyframes atmosphere { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .splash::before, .orbit, .orbit::before, .orbit::after { animation: none; }
      .progress-fill { transition: none; }
    }
  </style>
</head>
<body>
  <main class="splash" aria-labelledby="splash-title">
    <div class="loader" aria-hidden="true">
      <span class="orbit"></span>
      <svg class="mark" viewBox="0 0 96 96" role="presentation">
        <defs><linearGradient id="moon-gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7fbff"/><stop offset=".55" stop-color="#87a2c8"/><stop offset="1" stop-color="#59e8ce"/></linearGradient></defs>
        <path class="moon" d="M67 14c-24 4-39 29-29 52 7 17 26 25 43 17-10 9-24 13-38 8C20 84 8 59 17 37 25 18 47 8 67 14Z"/>
        <path class="play" d="M42 34 66 48 42 62Z"/>
      </svg>
    </div>
    <div class="copy"><h1 id="splash-title">Opening NightWatch</h1><p id="splash-detail">Starting the cinema</p></div>
    <div class="progress-shell">
      <div class="progress-meta"><span>Startup progress</span><output id="splash-percent">12%</output></div>
      <div class="progress-track" role="progressbar" aria-label="NightWatch startup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="12"><div class="progress-fill"></div></div>
    </div>
    <span class="hint">Moonlit rooms · shared moments</span>
  </main>
  <script>
    window.nightwatchSplash = {
      update(state) {
        const progress = Math.max(0, Math.min(100, Number(state.progress) || 0));
        document.getElementById('splash-title').textContent = state.label;
        document.getElementById('splash-detail').textContent = state.detail;
        document.getElementById('splash-percent').textContent = progress + '%';
        document.querySelector('.progress-fill').style.width = progress + '%';
        document.querySelector('.progress-track').setAttribute('aria-valuenow', String(progress));
      }
    };
  </script>
</body>
</html>`;
}
