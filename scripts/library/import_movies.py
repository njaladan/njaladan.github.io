#!/usr/bin/env python3
"""Import Letterboxd CSVs without publishing profile URLs, ratings, or reviews."""

import argparse
import csv
import hashlib
import json
from datetime import date
from pathlib import Path


def film_key(row):
    return (row["Name"].strip().casefold(), row["Year"].strip())


def film_id(key):
    return hashlib.sha256("\0".join(key).encode()).hexdigest()[:12]


def import_movies(diary, watched):
    films = {}
    for row in watched:
        key = film_key(row)
        films.setdefault(key, {"id": film_id(key), "title": row["Name"].strip(), "year": row["Year"].strip()})
    viewings = []
    logged = set()
    for row in diary:
        key = film_key(row)
        film = films.setdefault(key, {"id": film_id(key), "title": row["Name"].strip(), "year": row["Year"].strip()})
        when = row.get("Watched Date", "").strip()
        if not when:
            continue
        date.fromisoformat(when)
        logged.add(key)
        viewings.append(
            {"film_id": film["id"], "date": when, "rewatch": row.get("Rewatch", "").strip().casefold() == "yes"}
        )
    viewings.sort(key=lambda item: item["date"], reverse=True)
    earlier = [films[key]["id"] for key in films if key not in logged]
    by_id = {film["id"]: film for film in films.values()}
    earlier.sort(key=lambda identity: by_id[identity]["title"].casefold())
    return {"films": list(films.values()), "viewings": viewings, "earlier": earlier}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("diary", type=Path)
    parser.add_argument("watched", type=Path)
    parser.add_argument("--output", type=Path, default=Path("_data/movies.json"))
    args = parser.parse_args()

    def read(path):
        with path.open(encoding="utf-8-sig", newline="") as stream:
            return list(csv.DictReader(stream))

    data = import_movies(read(args.diary), read(args.watched))
    if args.output.exists():
        previous = {film["id"]: film for film in json.loads(args.output.read_text())["films"]}
        for film in data["films"]:
            for field in ("cover", "art_source"):
                if field in previous.get(film["id"], {}):
                    film[field] = previous[film["id"]][field]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(
        f"Imported {len(data['films'])} films, {len(data['viewings'])} viewings, "
        f"and {len(data['earlier'])} earlier watches."
    )


if __name__ == "__main__":
    main()
