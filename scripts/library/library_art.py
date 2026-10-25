#!/usr/bin/env python3
"""Cache matched book covers and movie posters locally; uncertain matches stay text covers.

Requires Pillow. No visitor requests, private profiles, or API keys are needed.
"""

import concurrent.futures
import html
import io
import json
import re
import unicodedata
import urllib.parse
import urllib.request

from PIL import Image

from scripts.common.paths import DATA, REPO

HEADERS = {"User-Agent": "GaneshPersonalLibrary/1.0 (personal reading and movie archive)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=20) as response:
        return response.read()


def normalize(title):
    title = unicodedata.normalize("NFKD", html.unescape(title)).casefold()
    return re.sub(r"[^a-z0-9]", "", title)


def save_image(url, dest):
    image = Image.open(io.BytesIO(get(url)))
    if image.width < 80 or image.height < 100:
        raise ValueError("No usable cover")
    image.thumbnail((300, 450))
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(dest, "WEBP", quality=82)


def movie(film):
    if film.get("cover") and (REPO / film["cover"].lstrip("/")).exists():
        return film
    query = urllib.parse.urlencode({"query": film["title"]})
    page = get("https://www.themoviedb.org/search?" + query).decode()
    cards = re.split(r'<div[^>]+class="comp:media-card', page)[1:]
    for card in cards:
        if 'data-media-type="movie"' not in card:
            continue
        title = re.search(r'<img[^>]+alt="([^"]+)"', card)
        release = re.search(r'class="release_date[^>]*>([^<]+)', card)
        art = re.search(r'https://media\.themoviedb\.org/t/p/[^/]+/([^"\s]+\.(?:jpg|png))', card)
        year = re.search(r"\b(\d{4})\b", release[1]) if release else None
        if not (title and year and art):
            continue
        if normalize(title[1]) != normalize(film["title"]) or abs(int(year[1]) - int(film["year"])) > 1:
            continue
        # Title and release year must agree; never guess from the first search hit.
        path = "/assets/images/movies/" + film["id"] + ".webp"
        save_image("https://media.themoviedb.org/t/p/w300/" + art[1], REPO / path.lstrip("/"))
        source = re.search(r'href="(/movie/[^"?]+)', card)
        film.update(cover=path, art_source="https://www.themoviedb.org" + source[1])
        break
    return film


BOOK_ALIASES = {
    "100 Years of Solitude": "One Hundred Years of Solitude",
    "Exhalations": "Exhalation",
    "Exhalations: Stories": "Exhalation",
    "20,000 Leagues Under the Sea": "Twenty Thousand Leagues Under the Sea",
    "7 Habits of Highly Effective People": "The 7 Habits of Highly Effective People",
    "The Paper Menagerie": "The Paper Menagerie and Other Stories",
    "Phantom of the Opera": "The Phantom of the Opera",
}


def cover_ratio(item):
    # Width over height of the saved cover; the book shelf shapes each 3D book to it.
    with Image.open(REPO / item["cover"].lstrip("/")) as image:
        item["cover_ratio"] = round(image.width / image.height, 3)
    return item


def book(item):
    if item.get("cover") and (REPO / item["cover"].lstrip("/")).exists():
        return cover_ratio(item)
    title = BOOK_ALIASES.get(item["title"], item["title"]).split(":")[0]
    expected_author = item.get("author", "").split(",")[0]
    if not expected_author:
        return item
    query = urllib.parse.urlencode(
        {"title": title, "author": expected_author, "limit": 8, "fields": "title,author_name,cover_i"}
    )
    data = json.loads(get("https://openlibrary.org/search.json?" + query))
    for doc in data.get("docs", []):
        if not any(normalize(expected_author) == normalize(author) for author in doc.get("author_name", [])):
            continue
        actual = normalize(doc.get("title", ""))
        wanted = normalize(title)
        if actual != wanted and not (actual.startswith(wanted) and len(actual) < len(wanted) + 24):
            continue
        if not doc.get("cover_i"):
            continue
        path = "/assets/images/books/" + item["id"] + ".webp"
        try:
            save_image(
                f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-M.jpg?default=false", REPO / path.lstrip("/")
            )
        except Exception:
            continue
        item.update(cover=path, art_source=f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-M.jpg")
        cover_ratio(item)
        break
    return item


def main():
    for filename, field, worker in [("movies.json", "films", movie), ("books.json", None, book)]:
        path = DATA / filename
        data = json.loads(path.read_text())
        items = data[field] if field else data

        def safe(item, worker=worker):
            try:
                return worker(item)
            except Exception:
                return item

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(safe, dict(item)): item for item in items}
            for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
                futures[future].update(future.result())
                if index % 40 == 0 or index == len(items):
                    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
                    print(
                        f"{filename}: {index}/{len(items)} checked; {sum(bool(i.get('cover')) for i in items)} covers",
                        flush=True,
                    )


if __name__ == "__main__":
    main()
