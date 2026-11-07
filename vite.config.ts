import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// The Cloudflare plugin runs the multiplayer Worker (src/server) inside the Vite
// dev server, so `npm run dev` serves both the site and the game rooms.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
