import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { createDiscordBridge } from '@/platform/discordBridge';
import { setPlatformBridge } from '@/platform/PlatformBridge';
import '@/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in index.discord.html');
}

const root = createRoot(rootElement);

async function bootstrap(): Promise<void> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (clientId === undefined || clientId.length === 0) {
    throw new Error('VITE_DISCORD_CLIENT_ID is required for the Activity build.');
  }

  // Bridge must be installed before App (and the Supabase client inside
  // it) does any network work, so patchUrlMappings is already active.
  setPlatformBridge(await createDiscordBridge(clientId));

  const { App } = await import('@/App');
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

bootstrap().catch((error: unknown) => {
  root.render(
    <div style={{ padding: '2rem', color: '#f87171', fontFamily: 'sans-serif' }}>
      NightWatch could not start inside Discord:{' '}
      {error instanceof Error ? error.message : String(error)}
    </div>,
  );
});
