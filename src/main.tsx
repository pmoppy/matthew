import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/fraunces';
import './styles.css';

// The installed web app updates itself via its service worker; the APK checks GitHub Releases instead.
if (!__NATIVE__) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
