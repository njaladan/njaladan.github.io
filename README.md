# nagaganesh.com

Source for [nagaganesh.com](https://nagaganesh.com): a Jekyll site with a short
biography, a reading library, a movie diary, a travel map, photos, and athletics.

## Development

Requires Ruby 3.3 with Bundler and Node 22. The data scripts also need Python 3.12.

```sh
bundle install
npm install
npm run serve    # http://localhost:4000, rebuilds on change
npm run check    # everything CI runs: ESLint, Prettier, Ruff and a Jekyll build
npm run format   # rewrite JS and CSS with Prettier
```

Pushes to `master` are built and deployed to GitHub Pages by
`.github/workflows/pages.yml`, which runs the same checks on every pull request.
Gem versions are pinned in `Gemfile.lock`.

## Layout

```
_pages/        Top-level pages (About, Reading, Movies, Travel, Photos, Athletics, 404)
_posts/        Book notes, plus old project posts kept with `published: false`
_layouts/      Page shells; `default` loads each page's `styles` and `scripts` front matter
_includes/     Shared header, footer and the travel app's markup
_data/         books.json and movies.json for the libraries
_plugins/      cache_bust.rb stamps asset URLs with the build time
assets/
  css/ js/       Site-wide and per-page styles and scripts
  images/        Logo, portraits, book covers and movie posters
  data/          Generated data loaded by pages (athletics shapes)
  travel/        The travel map app: scripts, styles, data, photos and vendored libraries
  codequeue/     Assets for the archived CodeQueue app
scripts/       Python data importers, grouped by section (library, athletics, travel)
docs/          Longer notes on the travel map
```

A page opts into its own assets through front matter:

```yaml
styles: [/assets/css/athletics.css]
scripts: [/assets/data/athletics-shapes.js, /assets/js/athletics.js]
```

Moved URLs use [`jekyll-redirect-from`](https://github.com/jekyll/jekyll-redirect-from)
(`redirect_from:` in the target page). `_layouts/redirect.html` keeps the query and
hash, so old `/atlas/#…` links still open the right place. The archived CodeQueue app
is still served at `/codequeue/` but isn't linked from the site or listed in the sitemap.

## Data

Install the script dependencies with `python -m pip install -r requirements.txt`.
Source exports (Letterboxd, Strava, original photos) stay outside the repository.

### Movies

`_data/movies.json` holds only titles, release years, viewing dates, rewatch flags and
poster metadata. Ratings, reviews, tags and added dates are deliberately left out. An
undated earlier watch can set `group_year` to place it in a release-year section without
inventing a viewing date.

```sh
python scripts/library/import_movies.py /path/to/diary.csv /path/to/watched.csv
```

`Watched Date` sets the diary order, newest first, and repeated diary entries are kept.
Films without a diary date are listed alphabetically under Other movies. Reimports keep
existing poster metadata.

### Books and artwork

Book notes are posts in `_posts/` and keep their original URLs. `_data/books.json` maps
post filenames to authors and local cover art.

```sh
python scripts/library/library_art.py
```

This refreshes local WebP covers and posters from Open Library and TMDB, matching on
title plus author or release year. Uncertain matches fall back to a generated title
cover. Visitors never request artwork from those providers, so keep the source credits
on the library pages.

### Athletics

`assets/data/athletics-shapes.js` holds every GPS activity as a shape: date, sport and
lines scaled into a 0–1000 box, with no real coordinates. Lines break where recording
paused. Distances count only actively tracked movement. Watch distances are used when
the file has them; otherwise GPS steps are summed, skipping pause jumps (trains, cars),
impossible speeds and lift rides. Duplicate uploads are dropped.

```sh
python scripts/athletics/summarize_strava.py /path/to/activities SUMMARY.json
python scripts/athletics/build_athletics_shapes.py /path/to/activities SUMMARY.json
```

The page stacks the selected shapes on a canvas; SVG stacking crashed iOS Safari.

### Travel and photos

See [`docs/travel.md`](docs/travel.md) for the map's architecture, data files and
import workflows. Photos are imported with `scripts/travel/import_photo.py` and shown
both on the map and at `/photos/`.

## JavaScript conventions

Scripts are plain browser scripts that share top-level functions and constants through
ordered `<script defer>` tags. Add any new cross-file global to `shared` in
`eslint.config.js`. Vendored libraries, generated data and `assets/codequeue/` are
excluded from linting and formatting.

`.git-blame-ignore-revs` lists bulk reformats; run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` to skip them in `git blame`.
