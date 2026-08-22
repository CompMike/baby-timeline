# Baby Heard Timeline

A single-file, offline timeline of due dates, parental leave, and family visits.
Source data: the shared Google Sheet, transcribed into `EVENTS` near the top of the
`<script>` block in `index.html`.

## Viewing

Open `index.html` directly in a browser, or serve the folder:

    python3 -m http.server 8777

then visit http://localhost:8777

## Deploying to baby.cheryleandmichael.com

The site is GitHub Pages, served from `main` at the repo root, so `index.html` *is*
the deployed page. To update it:

    git add -A && git commit -m "update dates" && git push

Pages rebuilds within a minute or so. `CNAME` holds the custom domain and must stay
in the repo — deleting it un-sets the domain in GitHub's settings.

DNS lives at Hover: a `CNAME` record for host `baby` pointing at `compmike.github.io.`
The domain also has a wildcard `*` record (Hover's parking page); the explicit `baby`
record takes precedence over it. Email (Hover hosted, `mx.hover.com.cust.hostedemail.com`)
is untouched by this setup, since the nameservers stay at Hover.

The page sends `noindex, nofollow` — reachable by link, kept out of search results.

## Publishing to a Claude Artifact

Published as a Claude Artifact:
https://claude.ai/code/artifact/f1d908dd-5f10-4612-b8ae-160afce3c285

It is private until shared from the page's share menu. The Artifact host supplies its
own `<head>`/`<body>` wrapper, so it publishes `artifact.html` — the page contents
only. After editing `index.html`, regenerate it:

    python3 build-artifact.py

then republish `artifact.html` to the same URL. Never edit `artifact.html` by hand;
it is overwritten on every build.

## v2 - the version with an admin panel

`/v2/` is a work-in-progress copy that reads its dates from a Cloudflare Worker
instead of having them baked in. **v1 at the site root is untouched and stays the
live version** until v2 is proven.

- `v2/index.html` - same timeline, but renders from its inline seed first and then
  upgrades to whatever the API returns. If the Worker is down, unreachable, or not
  deployed yet, the page still works and shows the seeded dates.
- `v2/admin.html` - password-protected editor.
- `v2/data.json` - the seed, and the single source of truth for the baked-in copy.
- `v2/config.js` - the one place the deployed Worker URL is set.
- `worker/` - the API. Password and session key live only as Worker secrets.

### First-time setup

    ./setup-worker.sh

It signs you in to Cloudflare, creates the KV namespace, prompts you for the admin
password, generates a random session key, and deploys. Then paste the printed URL
into `v2/config.js` and push.

### Working on it locally

    npm run dev     # Worker on :8787 with local KV
    npm run site    # static site on :8777

Then open http://localhost:8777/v2/. Local credentials come from `worker/.dev.vars`
(gitignored) and are not the real ones.

### Security notes

- The password is only ever compared inside the Worker, using a timing-safe
  comparison, and is stored as a Cloudflare secret - not in this repo.
- Sessions are HMAC-signed tokens that expire after 8 hours. Nothing is stored per
  session, so there is no session store to leak.
- Failed logins are counted per IP; 8 within 15 minutes blocks further attempts.
- Every save is validated server-side (real dates, end after start, known colours,
  unique ids) so a bad edit cannot break the public page.
- `admin.html` being publicly reachable is fine - it is only a form; every check
  happens in the Worker.

## Editing the dates

Everything lives in `index.html`:

- `EVENTS` — the timeline rows. `date` makes a single-day milestone (diamond);
  `start`/`end` make a bar. `cat` picks the colour (`baby`, `visit`, `work`, `family`).
- An event with an `options` array becomes a switchable row with its own
  Option 1 / Option 2 / Compare control. Each option carries a `spans` array, so an
  option can be **split into several stretches** — Michael's Option 1 is two, drawn as
  two bars joined by a dashed `gapLabel` connector.
- `visitor: true` opts a row into overlap detection (the hatched bands). Options
  belonging to the same person are never flagged against each other.
- `CHERYLE_LEAVE` is referenced by both her timeline row and the leave summary maths,
  so her dates only need changing in one place.
- `TBD` — the "Still to be decided" cards.
- `SPAN_START` / `SPAN_END` — the visible date range. Extend `SPAN_END` if any date
  moves past it, or the bar will run off the chart.

## Overlaps

Overlapping visitor stays are drawn as hatched vertical bands. Hovering one shows the
exact overlap dates, how many days both parties are here, and each side's full stay.
Bands are solid when both stays are confirmed and dashed when either comes from an
option you're still comparing — those tooltips are tagged "if you pick these options".

## Header font

The title is set in **Simply Playful** by Keithzo, embedded as a base64 WOFF2 in
`index.html` (adds ~36 KB). Licence and provenance are in `font/`. Its letters are
individually coloured from the crib palette, written as static spans rather than
painted by script so the header renders on first paint.

Note the per-letter spans suppress kerning, and they are `inline-block`, which lets a
line break fall between any two letters — hence `h1 .w { white-space: nowrap }`
around each word. Keep that rule if you edit the title.

## Look and feel

- The palette lives in the single `:root` block at the top of the `<style>`.
  The page is deliberately **light-only**: there is no dark palette, and
  `color-scheme: light` keeps scrollbars and controls light on dark systems. `--baby`, `--visit`, `--work`, `--family` are the four category
  colours; `--wood` tints the crib; `--hero-a` / `--hero-b` are the header gradient.
- The crib is a hand-written inline `<svg>` in the header — no image file; it draws
  from the same palette variables as everything else.
- Decorative layers (date labels, gridlines, connectors) are `pointer-events: none`
  so they don't block the overlap-band tooltips underneath.

No build step, no dependencies, no network calls.
