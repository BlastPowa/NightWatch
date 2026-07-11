import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initCloudSync } from '@/lib/engagement/CloudSync';
import { electronBridge } from '@/platform/electronBridge';
import { setPlatformBridge, webBridge } from '@/platform/PlatformBridge';
import '@/index.css';

setPlatformBridge(typeof window.nightwatch !== 'undefined' ? electronBridge : webBridge);
initCloudSync();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
