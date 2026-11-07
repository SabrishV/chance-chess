import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Website-only build (no Cloudflare Worker), used when the site is hosted on
// Vercel and online game rooms run on Cloudflare. See `npm run build:site`.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
});
