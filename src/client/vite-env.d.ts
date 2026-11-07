/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Host of the Cloudflare Worker that runs online game rooms, when the site is hosted elsewhere. */
  readonly VITE_GAME_SERVER?: string;
}
