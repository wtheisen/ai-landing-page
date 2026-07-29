#!/usr/bin/env python3
"""Fetch book covers for library items listed in ``resources.csv``."""

from __future__ import annotations

import argparse
import csv
import difflib
import pathlib
import re
import sys
import time
from dataclasses import dataclass
from typing import Iterable, Iterator, List, Sequence, Tuple

import requests


SEARCH_URL = "https://openlibrary.org/search.json"
COVER_FMT = "https://covers.openlibrary.org/b/{key}/{value}-{size}.jpg?default=false"
GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes"
GOOGLE_BOOKS_DISABLED = False

ISBN_KEYS = (
    "isbn",
    "isbn_13",
    "isbn13",
    "isbn_10",
    "isbn10",
    "isbn-10",
    "isbn-13",
)
OLID_KEYS = (
    "olid",
    "openlibrary_id",
    "openlibrary_work",
    "openlibrary_edition",
)
COVER_ID_KEYS = (
    "openlibrary_cover_id",
    "cover_id",
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_RESOURCES = REPO_ROOT / "static" / "csv" / "resources.csv"
DEFAULT_DEST = REPO_ROOT / "static" / "img" / "book_cover_thumbnails"
DEFAULT_SIZE = "L"
DEFAULT_TIMEOUT = 20

ISBN_CLEAN_RE = re.compile(r"[^0-9Xx]")
OLID_CLEAN_RE = re.compile(r"[^A-Za-z0-9]")
TOKEN_SPLIT_RE = re.compile(r"[\s,;/|]+")
TITLE_NORMALIZE_RE = re.compile(r"[^a-z0-9]+")


def normalize_key(value: str) -> str:
    return (value or "").strip().lower().replace(" ", "_")


def build_header_map(fieldnames: Sequence[str]) -> dict[str, str]:
    return {normalize_key(name): name for name in fieldnames if name}


def row_value(row: dict[str, str], header_map: dict[str, str], *keys: str) -> str:
    for key in keys:
        actual = header_map.get(normalize_key(key))
        if actual is None:
            continue
        return (row.get(actual) or "").strip()
    return ""


def split_tokens(value: str) -> Iterator[str]:
    for token in TOKEN_SPLIT_RE.split(value or ""):
        trimmed = token.strip()
        if trimmed:
            yield trimmed


def unique(seq: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in seq:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def slugify(name: str) -> str:
    """Convert a name to a filesystem-safe slug (matches resources.js logic)."""
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


@dataclass
class LibraryItem:
    index: int
    book_id: str
    title: str
    slug: str  # Slugified title for filename
    author: str
    isbns: List[str]
    olids: List[str]
    cover_ids: List[str]


def collect_isbns(row: dict[str, str], header_map: dict[str, str]) -> List[str]:
    values: List[str] = []
    for key in ISBN_KEYS:
        raw = row_value(row, header_map, key)
        if not raw:
            continue
        for token in split_tokens(raw):
            cleaned = ISBN_CLEAN_RE.sub("", token).upper()
            if cleaned:
                values.append(cleaned)
    return unique(values)


def collect_olids(row: dict[str, str], header_map: dict[str, str]) -> List[str]:
    values: List[str] = []
    for key in OLID_KEYS:
        raw = row_value(row, header_map, key)
        if not raw:
            continue
        for token in split_tokens(raw):
            cleaned = OLID_CLEAN_RE.sub("", token).upper()
            if cleaned:
                values.append(cleaned)
    return unique(values)


def collect_cover_ids(row: dict[str, str], header_map: dict[str, str]) -> List[str]:
    values: List[str] = []
    for key in COVER_ID_KEYS:
        raw = row_value(row, header_map, key)
        if not raw:
            continue
        for token in split_tokens(raw):
            cleaned = re.sub(r"[^0-9]", "", token)
            if cleaned:
                values.append(cleaned)
    return unique(values)


def looks_like_library(row: dict[str, str], header_map: dict[str, str]) -> bool:
    export_id = row_value(row, header_map, "export_id", "group", "group_id", "section_id")
    obj_id = row_value(row, header_map, "id")
    entry_type = row_value(row, header_map, "type")

    def matches(token: str) -> bool:
        lower = token.lower()
        return lower.startswith("lib-") or "library" in lower

    for token in (export_id, obj_id):
        if token and matches(token):
            return True

    if entry_type and entry_type.strip().lower() == "book":
        return True

    return False


def extract_library_items(rows: List[dict[str, str]], header_map: dict[str, str]) -> List[LibraryItem]:
    items: List[LibraryItem] = []
    for idx, row in enumerate(rows):
        if not looks_like_library(row, header_map):
            continue
        book_id = row_value(row, header_map, "id") or row_value(row, header_map, "export_id")
        if not book_id:
            continue
        title = row_value(row, header_map, "name", "title")
        author = row_value(row, header_map, "author")
        items.append(
            LibraryItem(
                index=idx,
                book_id=book_id.strip(),
                title=title.strip(),
                slug=slugify(title),
                author=author.strip(),
                isbns=collect_isbns(row, header_map),
                olids=collect_olids(row, header_map),
                cover_ids=collect_cover_ids(row, header_map),
            )
        )
    return items


def load_resources(path: pathlib.Path) -> Tuple[List[dict[str, str]], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise RuntimeError(f"CSV at {path} has no header")
        rows = []
        for raw in reader:
            row = {field: (raw.get(field) or "").strip() for field in reader.fieldnames}
            rows.append(row)
    header_map = build_header_map(reader.fieldnames)
    return rows, header_map


def normalize_match_text(value: str) -> str:
    return TITLE_NORMALIZE_RE.sub(" ", (value or "").lower()).strip()


def title_variants(title: str) -> List[str]:
    """Return progressively broader catalog-title variants."""
    without_parenthetical = re.sub(r"\s*\([^)]*\)\s*", " ", title).strip()
    before_subtitle = without_parenthetical.split(":", 1)[0].strip()
    return unique(
        value
        for value in (title.strip(), without_parenthetical, before_subtitle)
        if value
    )


def primary_author(author: str) -> str:
    """Use the first listed author for APIs that treat author as one entity."""
    return re.split(r"\s*(?:,|&|\band\b)\s*", author, maxsplit=1, flags=re.IGNORECASE)[0].strip()


def bibliographic_match_score(
    got_title: str,
    got_authors: str,
    want_title: str,
    want_author: str,
) -> float:
    wanted_titles = [normalize_match_text(value) for value in title_variants(want_title)]
    got_title = normalize_match_text(got_title)
    if not got_title or not wanted_titles:
        return 0.0

    title_score = max(
        difflib.SequenceMatcher(None, got_title, wanted).ratio()
        for wanted in wanted_titles
    )
    if got_title in wanted_titles:
        title_score = 1.0

    # Do not confuse two volumes in the same titled series when both have
    # different subtitles (for example, "An Introduction" vs.
    # "Advanced Topics").
    wanted_full = wanted_titles[0]
    wanted_base = wanted_titles[-1]
    if (
        got_title.startswith(wanted_base + " ")
        and wanted_full.startswith(wanted_base + " ")
        and got_title != wanted_full
        and difflib.SequenceMatcher(None, got_title, wanted_full).ratio() < 0.85
    ):
        return 0.0

    wanted_author = normalize_match_text(primary_author(want_author))
    got_authors = normalize_match_text(got_authors)
    author_score = 0.0
    if wanted_author:
        wanted_tokens = set(wanted_author.split())
        got_tokens = set(got_authors.split())
        author_score = len(wanted_tokens & got_tokens) / max(1, len(wanted_tokens))

    if wanted_author and (title_score < 0.78 or author_score == 0):
        return 0.0
    if not wanted_author and title_score < 0.9:
        return 0.0
    return title_score * 0.8 + author_score * 0.2


def google_book_match_score(volume: dict, want_title: str, want_author: str) -> float:
    """Score a Google Books result conservatively to avoid incorrect covers."""
    info = volume.get("volumeInfo") or {}
    return bibliographic_match_score(
        info.get("title") or "",
        " ".join(info.get("authors") or []),
        want_title,
        want_author,
    )


def search_open_library(title: str, author: str, timeout: int) -> List[Tuple[str, str]]:
    docs_by_key = {}
    query_author = primary_author(author)
    for query_title in title_variants(title):
        params = {"title": query_title, "limit": 10}
        if query_author:
            params["author"] = query_author
        try:
            response = requests.get(SEARCH_URL, params=params, timeout=timeout)
            response.raise_for_status()
            docs = response.json().get("docs", [])
        except (requests.RequestException, ValueError) as exc:
            print(f"[warn] search failed for '{query_title}': {exc}", file=sys.stderr)
            continue
        for doc in docs:
            key = doc.get("key") or f"{doc.get('title')}|{doc.get('cover_i')}"
            docs_by_key[key] = doc

    ranked = sorted(
        (
            (
                bibliographic_match_score(
                    doc.get("title") or "",
                    " ".join(doc.get("author_name") or []),
                    title,
                    author,
                ),
                doc,
            )
            for doc in docs_by_key.values()
        ),
        key=lambda pair: pair[0],
        reverse=True,
    )
    candidates: List[Tuple[str, str]] = []
    for score, doc in ranked:
        if score <= 0:
            continue
        if doc.get("cover_i"):
            candidates.append(("id", str(doc["cover_i"])))
        for edition in (doc.get("edition_key") or [])[:3]:
            candidates.append(("olid", edition))
        for isbn in (doc.get("isbn") or [])[:3]:
            candidates.append(("isbn", isbn))
    return candidates


def search_google_books(title: str, author: str, timeout: int) -> Tuple[str, bytes] | Tuple[None, None]:
    """Find and download a conservatively matched Google Books cover."""
    global GOOGLE_BOOKS_DISABLED
    if GOOGLE_BOOKS_DISABLED:
        return (None, None)

    query = f'intitle:"{title}"'
    if author:
        query += f' inauthor:"{author}"'
    params = {
        "q": query,
        "maxResults": 10,
        "printType": "books",
        "projection": "lite",
    }
    try:
        response = requests.get(GOOGLE_BOOKS_SEARCH_URL, params=params, timeout=timeout)
        response.raise_for_status()
        volumes = response.json().get("items") or []
    except (requests.RequestException, ValueError) as exc:
        if isinstance(exc, requests.HTTPError) and exc.response is not None and exc.response.status_code == 429:
            GOOGLE_BOOKS_DISABLED = True
            print("[warn] Google Books rate limited this run; disabling further queries.", file=sys.stderr)
            return (None, None)
        print(f"[warn] Google Books search failed for '{title}': {exc}", file=sys.stderr)
        return (None, None)

    ranked = sorted(
        (
            (google_book_match_score(volume, title, author), volume)
            for volume in volumes
        ),
        key=lambda pair: pair[0],
        reverse=True,
    )
    for score, volume in ranked:
        if score <= 0:
            continue
        image_links = (volume.get("volumeInfo") or {}).get("imageLinks") or {}
        image_url = next(
            (
                image_links.get(size)
                for size in (
                    "extraLarge",
                    "large",
                    "medium",
                    "small",
                    "thumbnail",
                    "smallThumbnail",
                )
                if image_links.get(size)
            ),
            None,
        )
        if not image_url:
            continue
        image_url = image_url.replace("http://", "https://", 1)
        try:
            cover_response = requests.get(
                image_url,
                headers={"User-Agent": "ai-landing-page-cover-fetcher/1.0"},
                timeout=timeout,
            )
            content_type = cover_response.headers.get("content-type", "")
            if (
                cover_response.status_code == 200
                and content_type.startswith("image/")
                and len(cover_response.content) > 1024
            ):
                return image_url, cover_response.content
        except requests.RequestException as exc:
            print(f"[warn] Google Books cover fetch failed for '{title}': {exc}", file=sys.stderr)
    return (None, None)


def download_candidate(key: str, value: str, size: str, timeout: int) -> Tuple[str, bytes] | Tuple[None, None]:
    url = COVER_FMT.format(key=key, value=value, size=size)
    try:
        response = requests.get(url, timeout=timeout)
    except requests.RequestException as exc:
        print(f"[warn] cover fetch error for {key}:{value}: {exc}", file=sys.stderr)
        return (None, None)

    content_type = response.headers.get("content-type", "")
    if response.status_code == 200 and content_type.startswith("image/"):
        return url, response.content
    return (None, None)


def gather_direct_candidates(item: LibraryItem) -> List[Tuple[str, str]]:
    candidates: List[Tuple[str, str]] = []
    for cid in item.cover_ids:
        candidates.append(("id", cid))
    for olid in item.olids:
        candidates.append(("olid", olid))
    for isbn in item.isbns:
        candidates.append(("isbn", isbn))
    return candidates


def fetch_cover_bytes(item: LibraryItem, size: str, timeout: int, pause: float) -> Tuple[str, bytes] | Tuple[None, None]:
    attempted: set[Tuple[str, str]] = set()

    for candidate in gather_direct_candidates(item):
        if candidate in attempted:
            continue
        attempted.add(candidate)
        url, content = download_candidate(*candidate, size=size, timeout=timeout)
        if content:
            return url, content
        if pause:
            time.sleep(pause)

    if not item.title:
        return (None, None)

    for candidate in search_open_library(item.title, item.author, timeout):
        if candidate in attempted:
            continue
        attempted.add(candidate)
        url, content = download_candidate(*candidate, size=size, timeout=timeout)
        if content:
            return url, content
        if pause:
            time.sleep(pause)

    if pause:
        time.sleep(pause)
    return search_google_books(item.title, item.author, timeout)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch Open Library covers for local library entries.")
    parser.add_argument("--resources", type=pathlib.Path, default=DEFAULT_RESOURCES, help="Path to resources CSV")
    parser.add_argument("--dest", type=pathlib.Path, default=DEFAULT_DEST, help="Directory for downloaded covers")
    parser.add_argument("--size", default=DEFAULT_SIZE, help="Open Library cover size (S, M, L)")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Request timeout in seconds")
    parser.add_argument("--pause", type=float, default=0.15, help="Pause between API calls in seconds")
    parser.add_argument("--limit", type=int, help="Maximum number of downloads in this run")
    parser.add_argument("--force", action="store_true", help="Re-download even if a thumbnail already exists")
    parser.add_argument("--dry-run", action="store_true", help="Report actions without writing files")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    resources_path = args.resources if args.resources.is_absolute() else (pathlib.Path.cwd() / args.resources)
    dest_path = args.dest if args.dest.is_absolute() else (pathlib.Path.cwd() / args.dest)
    args.resources = resources_path.resolve()
    args.dest = dest_path.resolve()

    if not args.resources.exists():
        print(f"Resources CSV not found at {args.resources}", file=sys.stderr)
        sys.exit(1)

    try:
        rows, header_map = load_resources(args.resources)
    except Exception as exc:
        print(f"Failed to load resources CSV: {exc}", file=sys.stderr)
        sys.exit(1)

    library_items = extract_library_items(rows, header_map)
    if not library_items:
        print("No library entries detected.")
        return

    args.dest.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    skipped_existing = 0
    missing = 0

    for item in library_items:
        if args.limit is not None and downloaded >= args.limit:
            break

        if not item.slug:
            missing += 1
            continue

        candidate_paths = [
            args.dest / f"{item.slug}{ext}"
            for ext in (".jpg", ".jpeg", ".png")
        ]
        existing_path = next((p for p in candidate_paths if p.exists()), None)

        if existing_path and not args.force and existing_path.stat().st_size > 0:
            skipped_existing += 1
            continue

        out_path = existing_path if existing_path else candidate_paths[0]

        url, content = fetch_cover_bytes(item, args.size, args.timeout, args.pause)
        if not content:
            missing += 1
            print(f"[info] no cover found for '{item.title or item.book_id}'")
            continue

        if args.dry_run:
            print(f"[dry-run] Would save cover for '{item.title}' ({item.slug}.jpg) from {url}")
        else:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(content)
            relative: pathlib.Path | str = out_path
            if out_path.is_absolute():
                for base in (REPO_ROOT, pathlib.Path.cwd()):
                    try:
                        relative = out_path.relative_to(base)
                        break
                    except ValueError:
                        continue
            if isinstance(relative, pathlib.Path):
                relative = relative.as_posix()
            print(f"Saved {relative} ({url})")
        downloaded += 1

    print(
        f"Done. downloaded={downloaded} skipped_existing={skipped_existing} missing={missing}"
    )


if __name__ == "__main__":
    main()
