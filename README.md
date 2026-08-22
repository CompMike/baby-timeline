# Baby Heard Timeline

A single-file, offline timeline of due dates, parental leave, and family visits.
Source data: the shared Google Sheet, transcribed into `EVENTS` near the top of the
`<script>` block in `index.html`.

## Viewing

Open `index.html` directly in a browser, or serve the folder:

    python3 -m http.server 8777

then visit http://localhost:8777

## Publishing

Published as a Claude Artifact:
https://claude.ai/code/artifact/f1d908dd-5f10-4612-b8ae-160afce3c285

It is private until shared from the page's share menu. The Artifact host supplies its
own `<head>`/`<body>` wrapper, so it publishes `artifact.html` — the page contents
only. After editing `index.html`, regenerate it:

    python3 build-artifact.py

then republish `artifact.html` to the same URL. Never edit `artifact.html` by hand;
it is overwritten on every build.

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

## Look and feel

- The palette lives in the two `:root` blocks at the top of the `<style>` (light,
  then dark). `--baby`, `--visit`, `--work`, `--family` are the four category
  colours; `--wood` tints the crib; `--hero-a` / `--hero-b` are the header gradient.
- The crib is a hand-written inline `<svg>` in the header — no image file, and it
  picks up the palette variables, so it re-tints automatically in dark mode.
- Decorative layers (date labels, gridlines, connectors) are `pointer-events: none`
  so they don't block the overlap-band tooltips underneath.

No build step, no dependencies, no network calls.
