import { describe, expect, it } from 'vitest';
import {
  buildStartupSplashHtml,
  buildStartupSplashUpdateScript,
  STARTUP_SPLASH_STAGES,
} from './startupSplash';

describe('startup splash', () => {
  it('ships an offline, accessible, reduced-motion splash', () => {
    const html = buildStartupSplashHtml();
    expect(html).toContain('Opening NightWatch');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('https://');
  });

  it('clamps progress updates before serializing them', () => {
    expect(buildStartupSplashUpdateScript({ label: 'Ready', detail: 'Done', progress: 140 }))
      .toContain('"progress":100');
    expect(buildStartupSplashUpdateScript({ label: 'Starting', detail: 'Wait', progress: -5 }))
      .toContain('"progress":0');
  });

  it('finishes both normal and degraded paths at 100 percent', () => {
    expect(STARTUP_SPLASH_STAGES.ready.progress).toBe(100);
    expect(STARTUP_SPLASH_STAGES.degraded.progress).toBe(100);
  });

  it('provides a branded install handoff and completion state', () => {
    expect(STARTUP_SPLASH_STAGES.updateInstalling.label).toBe('Updating NightWatch');
    expect(STARTUP_SPLASH_STAGES.updateFinishing.progress).toBeGreaterThan(
      STARTUP_SPLASH_STAGES.updateInstalling.progress,
    );
    expect(STARTUP_SPLASH_STAGES.updateReady.progress).toBe(100);
  });
});
