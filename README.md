# Chance Chess

Chess with a twist of luck: before every turn you draw a card that decides what you can do.
Play the computer, pass & play on one device, or play a friend online with a share link.

## Rules

Normal chess movement, plus:

- **Draw a card before every turn.** Each player has their own 40-card deck, reshuffled when it runs out. The "Cards left" panel shows both decks, so you can count cards.
- **Win by capturing the king.** There is no check or checkmate: you may leave your king attacked, and the game ends when a king is actually taken. (Castling still can't pass through attacked squares.)

| Card | Count | Effect |
| --- | --- | --- |
| 1 · Move | 20 | One normal move. |
| 2 · Double Move | 5 | Two moves in a row; the second is optional. |
| 0 · Skip | 4 | You lose the turn. |
| −1 · Undo | 3 | Your most recent move is taken back (a captured piece returns to the board), and you lose the turn. If that move can't be reversed any more (the piece was captured, or its old square is now occupied), nothing happens. |
| ★ · Wild | 5 | Swap one of your pawns for a piece you captured; it joins your side. Captured pawns can't be swapped in. Or make a normal move instead. |
| ⌖ · Teleport | 3 | Move any of your pieces to any empty square (no captures; pawns can't land on the first or last rank). Or make a normal move instead. |

**House rule (on by default, can be turned off on the home page):** giving check ends a Double Move. Without it, a Double Move can check and then capture the king before the opponent can respond, which decided most AI-vs-AI test games. This is the same rule used in Marseillais double-move chess.

Draws: 200 turns in total, or only the kings left.

## Development

```bash
npm install
npm run dev      # http://localhost:5173 — site + multiplayer rooms in one server
npm test         # rules engine + AI tests
npm run typecheck
npm run build    # production build, including the pre-rendered home page
npm run preview  # build, then serve it locally like Cloudflare would
```

To try online play locally, create a game and open the invite link in a second tab (each tab is its own player).

## SEO

- The home page (hero, how to play, card gallery, FAQ) is pre-rendered into `index.html` at build time by `scripts/prerender.mjs`, so crawlers and link previews get real content. The app then takes over in the browser.
- `index.html` has the title, description, Open Graph / Twitter tags and `VideoGame` structured data; the build adds `FAQPage` structured data from `src/client/content.ts`.
- Set `SITE_URL` when building for your real domain to add the canonical URL, absolute image URLs and `sitemap.xml` (a `robots.txt` is always written):

  ```bash
  SITE_URL=https://your-domain.example npm run deploy
  ```

- Icons and the link-preview image (`public/*.png`) are rendered from `scripts/brand/` with `scripts/render-brand.sh` (needs Chromium or Chrome).

## Deploying

Online games run on Cloudflare Workers with Durable Objects, via [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) (the successor to PartyKit). There is no server for you to manage: each room is a Durable Object that Cloudflare runs on demand, and the site is served as static assets from the same Worker.

```bash
npx wrangler login   # one time, needs a (free) Cloudflare account
npm run deploy       # builds, then deploys to https://chance-chess.<your-subdomain>.workers.dev
```

## Credits

- Chess pieces: the "Celtic" set by Maurizio Monge, [MIT licence](public/pieces/LICENSE.txt).
- Fonts: Fredoka and Nunito (SIL Open Font License), self-hosted via Fontsource.

## Project layout

```
src/engine/   Pure TypeScript rules: board & move generation, cards, turn flow, AI.
              Shared by the browser (local/AI games) and the Worker (online games).
src/server/   Cloudflare Worker + GameRoom Durable Object (one per online room).
src/shared/   Message types between browser and server.
src/client/   React UI. The AI runs in a Web Worker so the page stays responsive.
public/       Piece artwork, icons, link-preview image, web app manifest.
scripts/      Build-time pre-rendering and brand image rendering.
tests/        Vitest tests, including perft checks for move generation.
```

The server is authoritative for online games: it draws the cards and validates every action, and clients never see the order of the decks.
