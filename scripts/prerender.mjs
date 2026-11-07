// Runs after `vite build`. Renders the home page to static HTML inside
// dist/client/index.html so search engines and link previews see real content,
// then writes robots.txt, sitemap.xml and absolute URLs for the main site address.
// Set SITE_URL to override that address (e.g. for a custom domain).
//
// Set CF_ANALYTICS_TOKEN (from Cloudflare dashboard > Web Analytics) to add
// Cloudflare's cookie-free analytics beacon.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const DIST = 'dist/client';
// The site's one official address. Every build (Vercel and the Cloudflare copy)
// points search engines here, so other addresses don't count as duplicates.
const SITE_URL = (process.env.SITE_URL || 'https://chance-chess-sab.vercel.app').replace(/\/+$/, '');
const ANALYTICS_TOKEN = (process.env.CF_ANALYTICS_TOKEN ?? '').trim();
if (ANALYTICS_TOKEN && !/^[A-Za-z0-9-]+$/.test(ANALYTICS_TOKEN)) throw new Error('CF_ANALYTICS_TOKEN looks wrong');

// JSON inside <script> must not be able to close the tag.
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const vite = await createServer({
  configFile: false,
  // Own cache so this doesn't clobber the dev server's optimized deps.
  cacheDir: 'node_modules/.vite-prerender',
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { render, FAQ } = await vite.ssrLoadModule('/src/client/entry-server.tsx');
  let html = await readFile(`${DIST}/index.html`, 'utf8');

  if (!html.includes('<div id="root"></div>')) throw new Error('index.html has no empty #root to fill');
  html = html.replace('<div id="root"></div>', `<div id="root">${render()}</div>`);

  // Fetch the Latin fonts used above the fold early, so the logo doesn't reflow.
  const fonts = (await readdir(`${DIST}/assets`)).filter((f) => /^(fredoka|nunito)-latin-wght-normal-.*\.woff2$/.test(f));
  const head = [
    ...fonts.map((f) => `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin />`),
    `<script type="application/ld+json">${jsonForScript({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    })}</script>`,
    `<link rel="canonical" href="${SITE_URL}/" />`,
    `<meta property="og:url" content="${SITE_URL}/" />`,
  ];
  html = html.replaceAll('content="/og-image.png"', `content="${SITE_URL}/og-image.png"`);
  html = html.replace('</head>', `    ${head.join('\n    ')}\n  </head>`);
  if (ANALYTICS_TOKEN) {
    const beacon = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${ANALYTICS_TOKEN}"}'></script>`;
    html = html.replace('</body>', `    ${beacon}\n  </body>`);
  }
  await writeFile(`${DIST}/index.html`, html);

  await writeFile(`${DIST}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(
    `${DIST}/sitemap.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`,
  );
  console.log(`prerender: home page rendered into ${DIST}/index.html`);
} finally {
  await vite.close();
}
