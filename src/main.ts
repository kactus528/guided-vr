import { App } from './app/App.js';

const app = new App(document.getElementById('app')!, document.getElementById('ui')!);
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { gvrApp: App }).gvrApp = app;
app.init().catch((e) => {
  console.error(e);
  const el = document.getElementById('toast');
  if (el) {
    el.textContent = `Startup failed: ${(e as Error).message}`;
    el.style.opacity = '1';
  }
});

// Offline support after first load (production builds only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('SW registration failed', e));
  });
}
