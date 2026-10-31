# Manhattan street coverage

Adds a walk, run or ride to the Manhattan coverage page (`/manhattan`).

## One-time setup

From the repository root, with Python 3.12 or newer:

```sh
uv sync --group scripts
# or: python -m pip install --group scripts   (pip 25.1+)
```

## Add an activity

1. Add the file. `.fit`, `.gpx` or `.tcx` all work, gzipped or not, and you can pass
   several at once. Keep the files outside the repository, because only their snapped
   Manhattan pieces are published.

   ```sh
   uv run python -m scripts.street_coverage.add ~/Downloads/walk.fit
   ```

   The script prints the distance added, the coverage change and any newly covered
   streets.

2. Format the data files, since CI checks that they are pretty-printed:

   ```sh
   npx prettier --write _data/manhattan_coverage.json scripts/street_coverage/state.json
   ```

3. Optional: preview the page at `/manhattan` with `npm run serve` (needs Ruby and
   `bundle install`).

4. Commit and push these three files:
   - `_data/manhattan_coverage.json`
   - `assets/data/athletics/manhattan.json`
   - `scripts/street_coverage/state.json`

   If you are working on a branch, merge it into `master` to publish.

## What to expect

- **Repeats:** a file that has already been counted is skipped, so running the script
  twice does no harm.
- **Outside Manhattan:** points outside Manhattan are ignored. A file with nothing in
  Manhattan reports "nothing to add".
- **Same date:** if the map already has a track from that date, the script warns you so
  you can check it is not the same activity twice.
- **Rebuild from scratch:** this also rewrites `state.json`.

  ```sh
  uv run python -m scripts.street_coverage.build activities/ --cache ~/.cache/street-coverage
  ```
