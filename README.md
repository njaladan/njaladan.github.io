# Ganesh’s website

A Jekyll site with a biography, reading library, movie library, and travel map.

The main navigation is About, Reading, Movies, and Travel. Athletics is deferred.
Book notes remain in `_posts` and keep their original URLs. Unused blog and project
pages and non-book posts are retained in source but excluded from the published site.
The old `/atlas/` URL redirects to `/travel/`.

## Movies

`_data/movies.json` contains only titles, release years, viewing dates, rewatch flags,
and matched poster metadata. Ratings, reviews, profile links, tags, and added dates
are deliberately absent. The source CSV exports stay outside the public repository.

Import updated exports with:

```sh
python scripts/import_movies.py /path/to/diary.csv /path/to/watched.csv
```

`Watched Date` determines the diary order, newest first. Repeated diary entries are
preserved. Films without a diary date appear alphabetically under Earlier watches;
the added date is never presented as a viewing date. Existing poster metadata is
preserved during reimports.

## Artwork and book notes

`_data/books.json` associates book-post filenames with authors and local cover art.
`scripts/library_art.py` optionally refreshes local WebP artwork from Open Library
and TMDB (Python and Pillow required). It accepts matched titles and release years;
uncertain or unavailable artwork uses a readable title cover. Supplied book authors
are preserved; matching artwork requires the author as well as the title. Visitors make no
requests to the artwork providers. Keep the source credits on the library pages.

Book covers with written notes open an accessible native dialog. Each also links
to the original note URL, so notes remain readable without JavaScript. Search and
sort enhance the static library; all entries are present in the generated HTML.

## Validation

```sh
python -m unittest discover -s tests
node --check assets/js/library.js
bundle exec jekyll build
```

See `travel/README.md` for the existing map’s data and import workflows.
