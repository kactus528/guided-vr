import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR and microphone access on the Quest.
// `npm run dev` serves a self-signed HTTPS URL on your LAN.
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  server: { host: true, https: {} },
  build: { target: 'es2022', sourcemap: true },
});
