// Minimal typing for the Vite env flag used in main.ts (keeps tsc happy without vite/client types).
interface ImportMetaEnv {
  readonly PROD: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
