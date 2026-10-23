# nagaganesh.com

Source for [nagaganesh.com](https://nagaganesh.com), a Jekyll site deployed to GitHub
Pages from `master` by `.github/workflows/pages.yml`.

```sh
bundle install && npm install
python -m pip install --group dev   # ruff; needs pip 25.1+
npm run serve    # http://localhost:4000
npm run check    # what CI runs: ESLint, Prettier, tsc, tests, Ruff and a Jekyll build
```

## Layout

```
_pages/           Site pages, one file per URL, including the Atom feed
_books/           Book notes, one file per book, at /<title>/ and on /reading
_drafts/          Unpublished project posts; preview with `jekyll serve --drafts`
_layouts/         default (page frame), book, reading, movies, redirect
_includes/        Header, footer and the movie card
_plugins/         cache_bust.rb: version-stamps asset URLs on every build
_data/            books.json and movies.json, read by Liquid at build time
archive/          The retired CodeQueue app, still served at /codequeue/
assets/
  css/            base.css on every page, plus one stylesheet per page or feature
  js/             One entry module per page; lib/ holds helpers they share
    travel/       The travel map: app.js wires map/, globe/, photos/,
                  itineraries/ and routes/; shared/ is used by more than one
  data/           JSON fetched by the browser at runtime (travel/, athletics/)
  images/         site/, projects/, books/, movies/ and travel/
  vendor/         Third-party libraries; versions in vendor/README.md
scripts/          Python importers that write _data/ and assets/data/
  common/         Paths and geometry shared by the importers
tests/            Node tests, mirroring assets/js/ one file per module
types/            Type declarations for the vendored globals
```

Data lives in two places on purpose: `_data/` is rendered into the HTML when Jekyll
builds, and `assets/data/` is downloaded by the page's JavaScript.

## Pages

Pages use the `default` layout and list their own `styles` and `modules` (ES modules)
in front matter; `scripts` loads classic scripts such as the vendored libraries.
`full_screen: true` drops the page frame and `base.css` for the travel map. Moved URLs
use `redirect_from:`.

Modules import each other with relative paths. `_plugins/cache_bust.rb` adds the
build's version to every asset URL and writes an import map so imported modules get it
too; scripts that build URLs at runtime use `stampedUrl()` from `assets/js/lib/assets.js`.

## Updating data

Install the importers' dependencies with `python -m pip install --group scripts` and
run them as modules from the repository root. Source exports stay outside the
repository.

```sh
# Movies (Letterboxd export) and library artwork
python -m scripts.library.import_movies diary.csv watched.csv
python -m scripts.library.library_art

# Athletics shapes (Strava export)
python -m scripts.athletics.summarize_strava activities/ SUMMARY.json
python -m scripts.athletics.build_athletics_shapes activities/ SUMMARY.json

# Travel map
python -m scripts.travel.import_photo photo.jpg --place "Louvre · Paris" --lat 48.86 --lon 2.34
python -m scripts.travel.import_strava export/ REVIEW.json
python -m scripts.travel.import_gpx track.gpx --journey trip --name "Ride" --countries 528
python -m scripts.travel.match_activities cache/
python -m scripts.travel.import_flights flights.csv
```

Importers write compact JSON; run `npm run format` afterwards, since CI checks that
data files are pretty-printed (`assets/data/athletics/` is exempt because of its size).
Production builds minify HTML, JS and JSON with `jekyll-minifier`.

## License

Code is MIT-licensed; the writing, photos and data are not. See [LICENSE](LICENSE).
