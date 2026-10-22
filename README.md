# Ganesh’s website

A Jekyll site with a biography, reading library, movie library, photos, and travel map.

The main navigation is About, Reading, Movies, Travel, Photos, and Athletics. All pages use
`_includes/site-header.html` and `assets/css/header.css` for the same compact header.
Photos live at `/photos/`; the previous `/travel/gallery/` URL redirects there.
Athletics (`/athletics/`) draws every GPS activity as a shape.
Book notes remain in `_posts` and keep their original URLs. Old project posts stay in
`_posts` with `published: false`.
The old `/atlas/` URL redirects to `/travel/`.

## Movies

`_data/movies.json` contains only titles, release years, viewing dates, rewatch flags,
and matched poster metadata. An undated earlier watch can include `group_year` to place
it in a release-year section without inventing a viewing date. Ratings, reviews,
profile links, tags, and added dates are deliberately absent. The source CSV exports
stay outside the public repository.

Import updated exports with:

```sh
python scripts/import_movies.py /path/to/diary.csv /path/to/watched.csv
```

`Watched Date` determines the diary order, newest first. Repeated diary entries are
preserved. Films without a diary date appear alphabetically under Other movies;
the added date is never presented as a viewing date. Existing poster metadata is
preserved during reimports.

## Artwork and book notes

`_data/books.json` associates book-post filenames with authors and local cover art.
`scripts/library_art.py` optionally refreshes local WebP artwork from Open Library
and TMDB (Python and Pillow required). It accepts matched titles and release years;
uncertain or unavailable artwork uses a readable title cover. Supplied book authors
are preserved; matching artwork requires the author as well as the title. Visitors make no
requests to the artwork providers. Keep the source credits on the library pages.

The home portrait shows the childhood photo on mouse hover. Tap the photo on
touchscreens, or press Enter or Space while focused, to toggle between photos. The site
uses the original logo and credits Emerson Hsieh in its footer.

Movie release years and viewing dates have separate labels and styles. Undated
movies stay below the diary. Book counts and the extra library introductions are omitted.

Reading defaults to earliest read, including without JavaScript. A folded corner with
faint writing marks book covers with notes and opens slightly on hover or keyboard
focus. Notes open an accessible native dialog. Each book with notes also links
to the original note URL, so notes remain readable without JavaScript. Search and
sort enhance the static library; all entries are present in the generated HTML.

The shared header uses a terracotta active underline and a gentle logo tilt on hover
or keyboard focus. Logo and folded-corner motion respect reduced-motion preferences.
Page navigation keeps the header steady while the content fades upward gently using
native document view transitions. Browsers without document transitions get an
incoming-content animation on internal navigation; reduced-motion preferences disable both.
Book search matches titles only, as indicated by its placeholder.
Photo cards use print-style borders, small serif subjects, muted sans-serif locations,
and a map arrow on hover or keyboard focus. Dates and repeated action labels are omitted.

## Athletics

Distances count only actively tracked movement: watch distances where the file has them, otherwise GPS steps without pause
jumps (trains, cars), impossible speeds, or lift rides; duplicate uploads are dropped. The Strava export and its per-activity
summary stay outside the repository; rebuild with:

```sh
python scripts/import_movies.py /path/to/diary.csv /path/to/watched.csv
```

`Watched Date` determines the diary order, newest first. Repeated diary entries are
preserved. Films without a diary date appear alphabetically under Other movies;
the added date is never presented as a viewing date. Existing poster metadata is
preserved during reimports.

## Artwork and book notes

`_data/books.json` associates book-post filenames with authors and local cover art.
`scripts/library_art.py` optionally refreshes local WebP artwork from Open Library
and TMDB (Python and Pillow required). It accepts matched titles and release years;
uncertain or unavailable artwork uses a readable title cover. Supplied book authors
are preserved; matching artwork requires the author as well as the title. Visitors make no
requests to the artwork providers. Keep the source credits on the library pages.

The home portrait shows the childhood photo on mouse hover. Tap the photo on
touchscreens, or press Enter or Space while focused, to toggle between photos. The site
uses the original logo and credits Emerson Hsieh in its footer.

Movie release years and viewing dates have separate labels and styles. Undated
movies stay below the diary. Book counts and the extra library introductions are omitted.

Reading defaults to earliest read, including without JavaScript. A folded corner with
faint writing marks book covers with notes and opens slightly on hover or keyboard
focus. Notes open an accessible native dialog. Each book with notes also links
to the original note URL, so notes remain readable without JavaScript. Search and
sort enhance the static library; all entries are present in the generated HTML.

The shared header uses a terracotta active underline and a gentle logo tilt on hover
or keyboard focus. Logo and folded-corner motion respect reduced-motion preferences.
Photo cards use print-style borders, small serif subjects, muted sans-serif locations,
and a map arrow on hover or keyboard focus. Dates and repeated action labels are omitted.

## Athletics

`athletics/mockups/data.js` holds only derived numbers: daily miles by sport, the
April 2025 marathon's mile splits and heart rate, the training log, and a few
highlights. It never contains GPS coordinates. Distances count only actively tracked
movement: watch distances where the file has them, otherwise GPS steps without pause
jumps (trains, cars), impossible speeds, or lift rides; duplicate uploads are dropped. The Strava export and its per-activity
summary stay outside the repository; rebuild with:

```sh
python scripts/summarize_strava.py /path/to/activities SUMMARY.json
python scripts/build_athletics_shapes.py /path/to/activities SUMMARY.json
```

`athletics/shapes.js` holds every GPS activity as a shape (date, sport, and lines
scaled into a 0–1000 box, with no real coordinates); lines break where recording
paused. The page shuffles the shapes on each visit, filters by sport and year, opens
one to draw it, and stacks the selection on a canvas (SVG stacking crashed iOS Safari).

## Validation

`.github/workflows/pages.yml` runs these checks on every push and pull request, then
builds and deploys `master` to GitHub Pages. Gem versions are pinned in `Gemfile.lock`.

```sh
bundle exec jekyll build
node --check assets/js/library.js
```

See `travel/README.md` for the existing map’s data and import workflows.

## JavaScript style

Site JavaScript is formatted with Prettier and linted with ESLint; CI runs both.
Vendored libraries, `athletics/shapes.js` and `codequeue/` are excluded.

```sh
npm install
npm run format   # rewrite files
npm run lint
```

The scripts share top-level functions and constants through ordered `<script defer>`
tags; add any new cross-file global to `shared` in `eslint.config.js`.
`.git-blame-ignore-revs` lists the bulk reformat; run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` to skip it in `git blame`.
