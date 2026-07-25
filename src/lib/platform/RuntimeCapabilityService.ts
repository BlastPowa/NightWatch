import {
  emptyManifest,
  parseRuntimeManifest,
  type RuntimeCapabilityManifestV2,
} from '@shared/runtimeCapabilities';
import {
  buildDiagnostic,
  formatDiagnostic,
  newOperationId,
  outcomeFromError,
  type SafeActionDiagnostic,
} from '@shared/safeDiagnostics';
import { log } from '@/lib/log';
import { supabase } from '@/lib/supabase';

/**
 * Phase 34 — the renderer's single source of truth for "what does the server
 * support, and am I actually signed in?".
 *
 * The packaged bug this fixes: capability detection ran before Supabase
 * finished restoring the persisted Discord session on relaunch, so a
 * legitimately signed-in user was detected as signed out and every social
 * surface hid itself with no stated reason. Two changes prevent that:
 *
 *   1. `whenSessionSettled()` — detection waits for the initial session
 *      restore instead of racing it.
 *   2. the manifest is invalidated and re-fetched on sign-in, sign-out, token
 *      refresh, network reconnect, and app resume, so a stale "signed out"
 *      answer cannot persist for the life of the process.
 */

export type ManifestListener = (manifest: RuntimeCapabilityManifestV2) => void;
export type DiagnosticListener = (diagnostic: SafeActionDiagnostic) => void;

const REFRESH_MIN_INTERVAL_MS = 3_000;

class RuntimeCapabilityService {
  private manifest: RuntimeCapabilityManifestV2 = emptyManifest();
  private inFlight: Promise<RuntimeCapabilityManifestV2> | null = null;
  private lastFetchAt = 0;
  private initialized = false;
  private sessionSettled = false;
  private resolveSettled: () => void = () => {};
  private readonly settledPromise = new Promise<void>((resolve) => {
    this.resolveSettled = () => {
      this.sessionSettled = true;
      resolve();
    };
  });
  private readonly manifestListeners = new Set<ManifestListener>();
  private readonly diagnosticListeners = new Set<DiagnosticListener>();

  /**
   * Wire auth/network/resume hooks once at startup. Idempotent, and safe to
   * call before the renderer knows whether a session exists.
   */
  public init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    // The initial getSession() resolves AFTER Supabase reads persisted
    // storage — that resolution is the signal detection was missing.
    void supabase.auth
      .getSession()
      .catch(() => null)
      .finally(() => {
        this.resolveSettled();
        void this.refresh('auth.session-restore');
      });

    supabase.auth.onAuthStateChange((event) => {
      switch (event) {
        case 'INITIAL_SESSION':
          this.resolveSettled();
          void this.refresh('auth.session-restore');
          break;
        case 'SIGNED_IN':
          void this.refresh('auth.sign-in', true);
          break;
        case 'SIGNED_OUT':
          this.publish(emptyManifest());
          void this.refresh('auth.sign-out', true);
          break;
        case 'TOKEN_REFRESHED':
        case 'USER_UPDATED':
          void this.refresh('auth.token-refresh', true);
          break;
        default:
          break;
      }
    });

    if (typeof window !== 'undefined') {
      // Network reconnect and app resume both invalidate a cached answer:
      // the previous one may have been produced while offline.
      window.addEventListener('online', () => {
        void this.refresh('capabilities.manifest', true);
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            void this.refresh('capabilities.manifest');
          }
        });
      }
    }
  }

  /** Resolves once the initial session restore has completed. */
  public whenSessionSettled(): Promise<void> {
    // Keep the service safe for diagnostic/packaged entry points that call
    // this method before the renderer's normal startup wiring has run.
    this.init();
    return this.settledPromise;
  }

  public isSessionSettled(): boolean {
    return this.sessionSettled;
  }

  public get(): RuntimeCapabilityManifestV2 {
    return this.manifest;
  }

  public subscribe(listener: ManifestListener): () => void {
    this.manifestListeners.add(listener);
    return () => {
      this.manifestListeners.delete(listener);
    };
  }

  public onDiagnostic(listener: DiagnosticListener): () => void {
    this.diagnosticListeners.add(listener);
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }

  /**
   * Fetch the manifest. Detection always waits for session settle first, so
   * a cold packaged launch cannot report a restored user as signed out.
   */
  public async refresh(
    feature = 'capabilities.manifest',
    force = false,
  ): Promise<RuntimeCapabilityManifestV2> {
    // `refresh` is also a public entry point. Auto-initialising here prevents
    // a permanent wait when a caller legitimately asks for capabilities
    // before App has explicitly initialised the service.
    this.init();
    if (this.inFlight !== null) {
      return this.inFlight;
    }
    const now = Date.now();
    if (!force && now - this.lastFetchAt < REFRESH_MIN_INTERVAL_MS) {
      return this.manifest;
    }

    this.inFlight = this.fetchManifest(feature).finally(() => {
      this.inFlight = null;
      this.lastFetchAt = Date.now();
    });
    return this.inFlight;
  }

  /** Drop cached state (sign-out, or an explicit user-triggered retry). */
  public reset(): void {
    this.manifest = emptyManifest();
    this.lastFetchAt = 0;
    this.inFlight = null;
    this.publish(this.manifest);
  }

  private async fetchManifest(feature: string): Promise<RuntimeCapabilityManifestV2> {
    await this.settledPromise;
    const operationId = newOperationId();
    const online = typeof navigator === 'undefined' || navigator.onLine;

    try {
      const { data, error } = await supabase.rpc('runtime_capabilities_v2');
      if (error !== null) {
        // A missing manifest RPC is an OLD deployment, not a broken client:
        // fall back to the 0024 diagnostic so a v0.1.27 database still yields
        // an authenticated flag rather than a blanket failure.
        const outcome = outcomeFromError(error);
        this.emit(
          buildDiagnostic(feature, outcome, {
            authenticated: this.manifest.authenticated,
            online,
            schemaGeneration: null,
          }, operationId),
        );
        if (outcome === 'deployment-missing') {
          return this.fetchLegacyFallback(operationId, online);
        }
        this.publish(emptyManifest());
        return this.manifest;
      }

      const manifest = parseRuntimeManifest(data);
      if (manifest === null) {
        this.emit(
          buildDiagnostic(feature, 'failed', {
            authenticated: false,
            online,
            schemaGeneration: null,
          }, operationId),
        );
        this.publish(emptyManifest());
        return this.manifest;
      }

      this.emit(
        buildDiagnostic(feature, 'success', {
          authenticated: manifest.authenticated,
          online,
          schemaGeneration: manifest.schemaGeneration,
        }, operationId),
      );
      this.publish(manifest);
      return manifest;
    } catch {
      this.emit(
        buildDiagnostic(feature, 'offline', {
          authenticated: this.manifest.authenticated,
          online: false,
          schemaGeneration: null,
        }, operationId),
      );
      this.publish(emptyManifest());
      return this.manifest;
    }
  }

  /**
   * Compatibility path for a database that predates 0028. Reads only the
   * fields social_diagnostics() already exposed; schemaGeneration stays 0 so
   * callers can tell this apart from a real manifest.
   */
  private async fetchLegacyFallback(
    operationId: string,
    online: boolean,
  ): Promise<RuntimeCapabilityManifestV2> {
    try {
      const { data, error } = await supabase.rpc('social_diagnostics');
      if (error !== null || typeof data !== 'object' || data === null) {
        this.publish(emptyManifest());
        return this.manifest;
      }
      const record = data as Record<string, unknown>;
      const functions =
        typeof record['functions'] === 'object' && record['functions'] !== null
          ? (record['functions'] as Record<string, unknown>)
          : {};
      const legacy: RuntimeCapabilityManifestV2 = {
        schemaGeneration: 0,
        authenticated: record['hasSession'] === true,
        functions: Object.fromEntries(
          Object.entries(functions).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
          ),
        ),
        realtimeTables: Array.isArray(record['realtimeTables'])
          ? (record['realtimeTables'] as unknown[]).filter(
              (table): table is string => typeof table === 'string',
            )
          : [],
      };
      this.emit(
        buildDiagnostic('capabilities.manifest', 'success', {
          authenticated: legacy.authenticated,
          online,
          schemaGeneration: 0,
        }, operationId),
      );
      this.publish(legacy);
      return legacy;
    } catch {
      this.publish(emptyManifest());
      return this.manifest;
    }
  }

  private publish(manifest: RuntimeCapabilityManifestV2): void {
    this.manifest = manifest;
    this.manifestListeners.forEach((listener) => listener(manifest));
  }

  private emit(diagnostic: SafeActionDiagnostic): void {
    log('info', formatDiagnostic(diagnostic));
    this.diagnosticListeners.forEach((listener) => listener(diagnostic));
  }
}

export const runtimeCapabilities = new RuntimeCapabilityService();

/**
 * Report a feature operation with the current manifest context attached.
 * The single call site every service should use, so no diagnostic is built
 * with hand-assembled (and potentially unsafe) fields.
 */
export function reportOperation(
  feature: string,
  outcome: SafeActionDiagnostic['outcome'],
  operationId?: string,
): SafeActionDiagnostic {
  const manifest = runtimeCapabilities.get();
  const diagnostic = buildDiagnostic(
    feature,
    outcome,
    {
      authenticated: manifest.authenticated,
      online: typeof navigator === 'undefined' || navigator.onLine,
      schemaGeneration: manifest.schemaGeneration === 0 ? null : manifest.schemaGeneration,
    },
    operationId,
  );
  log('info', formatDiagnostic(diagnostic));
  return diagnostic;
}
