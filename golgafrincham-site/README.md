# Golgafrincham

A cargo hold of side projects ("gloriously unnecessary work"), Hitchhiker's-flavoured.
The landing page lives at the site root; each project gets a directory.

**Cargo 001 — Earth Orbit Catalog**: a single-file, zero-backend 3-D tracker for the complete CelesTrak *active* catalog
(~16,000 satellites), propagated in the browser with SGP4. Includes per-satellite
mission metadata, category filters, search, time acceleration, and an observer mode
that lists what's overhead from your location and flags sunlit naked-eye candidates.

The tracker ships inside one `tracker/index.html` (~2 MB): element sets and metadata are
embedded as gzip payloads, so **visitors never query CelesTrak** — only the daily
build bot does, once.

## Deploy on GitHub Pages (recommended — free, auto-refreshing)

1. Create a new GitHub repository and push this folder's contents to `main`.
2. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / root.
3. **Actions** tab → enable workflows if prompted.

That's it. The landing page is live at `https://<user>.github.io/<repo>/` and the
tracker at `.../tracker/`. The `refresh-data` workflow re-fetches element sets daily
at 05:23 UTC, rebuilds `tracker/index.html`, and commits it — Pages redeploys automatically. You can trigger a
refresh manually anytime from the Actions tab (*Run workflow*). If a fetch fails,
the previous day's data stays live; the build refuses to publish an implausibly
small catalog.

A custom domain can be attached under Settings → Pages → Custom domain.

## Deploy anywhere else (no auto-refresh)

`tracker/index.html` is fully self-contained (plus three.js from the cdnjs CDN). Drag it
into Netlify Drop, Cloudflare Pages, S3, or any web server and it works — orbits
just age until you rebuild, and users can always paste fresher data via
**LOAD TLE SET** in the app.

## Rebuild locally

```
bash build/fetch.sh        # optional: pull fresh data (pure curl)
python3 build/build.py     # stdlib only, no pip installs
python3 -m http.server     # preview at http://localhost:8000
```

## Layout

```
index.html            Golgafrincham landing page (static, hand-written)
tracker/index.html    built tracker (committed so Pages can serve it directly)
src/                  head.html, app.js, tables.js, coast.js, vendor/satellite.min.js
data/active.tle       full active catalog (refreshed daily)
data/groups/*.tle     category tag sources (refreshed daily)
data/satcat.csv       CelesTrak SATCAT (refreshed daily)
data/ucs.psv          UCS Satellite Database extract (static — final release May 2023)
build/fetch.sh        polite data fetcher with mirror fallback
build/build.py        payload packer + assembler
```

## Data & credits

- **Orbital elements & SATCAT** — [CelesTrak](https://celestrak.org), Dr. T.S. Kelso.
  Fetched once daily by CI with an identifying user agent; please keep it that way.
- **Mission metadata** — UCS Satellite Database (Union of Concerned Scientists),
  final May 2023 release; newer craft use the tracker's built-in constellation notes.
- **Propagation** — [satellite.js](https://github.com/shashwatak/satellite-js) (MIT), vendored.
- **Rendering** — [three.js](https://threejs.org) r128 (MIT) via cdnjs.
- **Coastlines** — derived from Natural Earth (public domain), simplified.
- **Earth imagery** — NASA Blue Marble (day) & Black Marble city lights (night),
  public domain, embedded at 2048×1024 (sourced via the three-globe repo).

Known limits, stated in the app's About panel: TLEs cannot encode NORAD IDs above
99,999 (crossed July 2026), so the newest launches are absent; the *active* set
excludes debris and rocket bodies; SGP4 accuracy degrades as elements age.
