import {
  buildDiagnostic,
  newOperationId,
  sanitizeDiagnostic,
  type SafeActionOutcome,
} from '@shared/safeDiagnostics';
import { log } from '@/lib/log';
import { getCachedRuntimeCapabilityManifest } from '@/lib/runtime/RuntimeCapabilityService';
import { supabase } from '@/lib/supabase';

export type { SafeActionOutcome } from '@shared/safeDiagnostics';

export function beginSafeAction(feature: string): {
  operationId: string;
  complete(outcome: SafeActionOutcome): void;
} {
  const id = newOperationId();
  return {
    operationId: id,
    complete(outcome): void {
      void supabase.auth.getSession().then(({ data }) => {
        const diagnostic = sanitizeDiagnostic(buildDiagnostic(feature, outcome, {
          authenticated: data.session !== null,
          online: typeof navigator === 'undefined' || navigator.onLine,
          schemaGeneration: getCachedRuntimeCapabilityManifest()?.schemaGeneration ?? null,
        }, id));
        log(outcome === 'success' ? 'info' : 'warn', `[action] ${JSON.stringify(diagnostic)}`);
      }).catch(() => {
        const diagnostic = sanitizeDiagnostic(buildDiagnostic(feature, outcome, {
          authenticated: false,
          online: typeof navigator === 'undefined' || navigator.onLine,
          schemaGeneration: getCachedRuntimeCapabilityManifest()?.schemaGeneration ?? null,
        }, id));
        log('warn', `[action] ${JSON.stringify(diagnostic)}`);
      });
    },
  };
}
