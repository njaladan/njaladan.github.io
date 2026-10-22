# nagaganesh.com

Source for [nagaganesh.com](https://nagaganesh.com), a Jekyll site deployed to GitHub
Pages from `master` by `.github/workflows/pages.yml`.

```sh
bundle install && npm install
npm run serve    # http://localhost:4000
npm run check    # what CI runs: ESLint, Prettier, Ruff and a Jekyll build
```

## Layout

```
_pages/    Site pages; book notes are posts in _posts/
_data/     books.json and movies.json
assets/    css/, js/, images/, data/ and vendor/, with travel/ subfolders for the map
scripts/   Python importers for the data, by section
```

Pages use the `default` layout and list their own `styles` and `scripts` in front
matter; `full_screen: true` drops the page frame for the travel map. Moved URLs use
`redirect_from:`. The archived CodeQueue app is still served at `/codequeue/` but not
linked.

## Updating data

Install dependencies with `pip install -r requirements.txt`. Source exports stay
outside the repository.

```sh
# Movies (Letterboxd export) and library artwork
python scripts/library/import_movies.py diary.csv watched.csv
python scripts/library/library_art.py

# Athletics shapes (Strava export)
python scripts/athletics/summarize_strava.py activities/ SUMMARY.json
python scripts/athletics/build_athletics_shapes.py activities/ SUMMARY.json

# Travel map
python scripts/travel/import_photo.py photo.jpg --place "Louvre · Paris" --lat 48.86 --lon 2.34
python scripts/travel/import_strava.py export/ REVIEW.json
python scripts/travel/import_gpx.py track.gpx --journey trip --name "Ride" --countries 528
python scripts/travel/match_activities.py cache/
python scripts/travel/import_flights.py flights.csv
```

Importers write compact JSON; run `npm run format` afterwards, since CI checks that
data files are pretty-printed. Production builds minify HTML, CSS, JS and JSON with `jekyll-minifier`.

Scripts share globals through ordered `<script defer>` tags; add new cross-file
globals to `shared` in `eslint.config.js`.
