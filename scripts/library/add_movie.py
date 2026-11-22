#!/usr/bin/env python3
"""Add one movie to _data/movies.json by hand.

Usage:
    python -m scripts.library.add_movie "Kill Bill: Vol. 2" 2004 2026-11-15
    python -m scripts.library.add_movie "Dune: Part Two" 2024 2024-03-02 --theater
    python -m scripts.library.add_movie "Neon Genesis Evangelion: The End of Evangelion" 1997 2026-11-22 --tmdb-id 18491

The film id is the repo's own hash (import_movies.film_id): the first 12 hex
chars of sha256("<lowercased title>\\0<year>"). Cover art comes from TMDB; when
the search cannot match the title and year (a re-release shows a newer date),
pass --tmdb-id to pin the exact movie. The site tracks only the first viewing
of a film, so a film that already has a viewing is refused.
"""

import argparse
import json
import re
import sys
from datetime import date

from scripts.common.paths import DATA, REPO
from scripts.library import library_art
from scripts.library.import_movies import film_id, film_key

MOVIES_JSON = DATA / "movies.json"


def _slug(title):
    return re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")


def _page_title(page):
    match = re.search(r"<title>([^<]+)</title>", page)
    return match.group(1) if match else ""


def _check_title_year(page, title, year):
    """True when a TMDB page is the film asked for: title and year agree."""
    heading = _page_title(page)
    found_year = re.search(r"\((\d{4})\)", heading)
    found_title = heading.split(" (")[0].strip()
    return library_art.normalize(found_title) == library_art.normalize(title) and bool(
        found_year and found_year.group(1) == year
    )


def _art_from_tmdb_id(film, tmdb_id):
    """Pin the exact TMDB movie: poster from its page, art_source from its id."""
    url = f"https://www.themoviedb.org/movie/{tmdb_id}"
    page = library_art.get(url).decode()
    if not _check_title_year(page, film["title"], film["year"]):
        raise ValueError(f"TMDB movie {tmdb_id} is not {film['title']} ({film['year']})")
    image = re.search(r'<meta property="og:image" content="([^"]+)"', page)
    if not image:
        raise ValueError(f"TMDB movie {tmdb_id} has no poster")
    art_url = re.sub(r"/t/p/[^/]+/", "/t/p/w300/", image.group(1))
    path = "/assets/images/movies/" + film["id"] + ".webp"
    library_art.save_image(art_url, REPO / path.lstrip("/"))
    source = f"https://www.themoviedb.org/movie/{tmdb_id}-{_slug(film['title'])}"
    return path, source


def _art_from_search(film):
    """Match the film on TMDB search; returns (cover, art_source) or (None, None)."""
    candidate = library_art.movie(dict(film))
    if not candidate.get("cover"):
        return None, None
    return candidate["cover"], candidate["art_source"]


def add_movie(title, year, watched, source="user_logged", theater=False, tmdb_id=None, no_art=False):
    title = title.strip()
    year = year.strip()
    if not re.fullmatch(r"\d{4}", year):
        raise ValueError(f"year must be four digits, got {year!r}")
    when = date.fromisoformat(watched).isoformat()
    key = film_key({"Name": title, "Year": year})
    identity = film_id(key)

    data = json.loads(MOVIES_JSON.read_text())
    films = {film["id"]: film for film in data["films"]}
    film = films.get(identity)
    if film is None:
        film = {"id": identity, "title": title, "year": year}
        data["films"].append(film)
    if any(viewing["film_id"] == identity for viewing in data["viewings"]):
        existing = next(v for v in data["viewings"] if v["film_id"] == identity)
        raise ValueError(
            f"{title} already has a viewing on {existing.get('date', existing.get('group_year'))}; "
            "the site tracks only the first viewing"
        )

    if not film.get("cover"):
        if tmdb_id is not None:
            cover, art_source = _art_from_tmdb_id(film, tmdb_id)
        else:
            cover, art_source = _art_from_search(film)
        if cover is None:
            if not no_art:
                raise ValueError(
                    f"no TMDB poster matched {title} ({year}); re-run with --tmdb-id <id> "
                    "from themoviedb.org, or pass --no-art to add it without a cover"
                )
            print(f"warning: adding {title} without cover art", file=sys.stderr)
        else:
            film["cover"] = cover
            film["art_source"] = art_source

    viewing = {"film_id": identity, "date": when, "source": source}
    if theater:
        viewing["theater"] = True
    viewings = data["viewings"]
    index = len(viewings)
    for position, existing in enumerate(viewings):
        if "date" not in existing or existing["date"] < when:
            index = position
            break
    viewings.insert(index, viewing)

    MOVIES_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return film, viewing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("title", help='film title, e.g. "Kill Bill: Vol. 2"')
    parser.add_argument("year", help="release year, e.g. 2004")
    parser.add_argument("watched", help="watch date, YYYY-MM-DD")
    parser.add_argument("--theater", action="store_true", help="watched in a theater")
    parser.add_argument("--source", default="user_logged", help="viewing source (default: user_logged)")
    parser.add_argument("--tmdb-id", type=int, help="TMDB movie id, when search cannot match the film")
    parser.add_argument("--no-art", action="store_true", help="add without cover art if TMDB has no match")
    args = parser.parse_args()
    try:
        film, viewing = add_movie(
            args.title,
            args.year,
            args.watched,
            source=args.source,
            theater=args.theater,
            tmdb_id=args.tmdb_id,
            no_art=args.no_art,
        )
    except (ValueError, OSError) as error:
        print(f"add_movie: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print(f"Added {film['title']} ({film['year']}) as {film['id']}, watched {viewing['date']}")
    if film.get("cover"):
        print(f"Cover: {film['cover']} ({film['art_source']})")


if __name__ == "__main__":
    main()
