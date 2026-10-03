"""Isolated benchmark for Lolzteam POST /search/posts pagination.

Production code is not imported or modified. By default this runs a deterministic
mock comparison. A live run is opt-in and reads token values only from files.

The intentionally tested "even/odd" strategy creates two independent search
windows with the same ``before`` cursor and assigns alternating result-page
numbers to different tokens. It is expected to be unsafe because ``links.next``
is an opaque, session/search-window cursor rather than a stable global page.
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional


@dataclass(frozen=True)
class Page:
    posts: tuple[dict, ...]
    next_cursor: Optional[str]


@dataclass
class Result:
    post_ids: list[int]
    elapsed: float

    def report(self) -> dict:
        return {
            "count": len(self.post_ids),
            "unique_count": len(set(self.post_ids)),
            "duplicates": len(self.post_ids) - len(set(self.post_ids)),
            "descending": self.post_ids == sorted(self.post_ids, reverse=True),
            "elapsed_seconds": round(self.elapsed, 6),
        }


def collect_sequential(first: Callable[[Optional[int]], Page], follow: Callable[[str], Page], limit: int) -> Result:
    started = time.perf_counter()
    page = first(None)
    ids: list[int] = []
    while True:
        ids.extend(int(post["post_id"]) for post in page.posts)
        if len(ids) >= limit or not page.next_cursor:
            break
        page = follow(page.next_cursor)
    return Result(ids[:limit], time.perf_counter() - started)


def collect_even_odd_unsafe(
    first_by_token: tuple[Callable[[Optional[int]], Page], Callable[[Optional[int]], Page]],
    follow_by_token: tuple[Callable[[str], Page], Callable[[str], Page]],
    limit: int,
) -> Result:
    """Model the proposed split; cursors are deliberately crossed by parity."""
    started = time.perf_counter()
    roots = [first_by_token[0](None), first_by_token[1](None)]
    ids: list[int] = []
    page_no = 0
    cursor = roots[0].next_cursor
    ids.extend(int(post["post_id"]) for post in roots[0].posts)
    while len(ids) < limit and cursor:
        page_no += 1
        token = page_no % 2
        page = follow_by_token[token](cursor)
        ids.extend(int(post["post_id"]) for post in page.posts)
        cursor = page.next_cursor
    return Result(ids[:limit], time.perf_counter() - started)


class MockSearch:
    """Opaque cursors are bound to the token/search window that created them."""

    def __init__(self, token: str, ids: list[int], page_size: int = 3):
        self.token = token
        self.ids = ids
        self.page_size = page_size

    def first(self, before: Optional[int]) -> Page:
        values = [value for value in self.ids if before is None or value < before]
        return self._page(values, 0)

    def follow(self, cursor: str) -> Page:
        owner, offset = cursor.split(":")
        if owner != self.token:
            # Real APIs commonly reject an expired/foreign search id. Returning
            # an empty page makes the completeness failure deterministic.
            return Page((), None)
        return self._page(self.ids, int(offset))

    def _page(self, values: list[int], offset: int) -> Page:
        chunk = values[offset : offset + self.page_size]
        next_offset = offset + self.page_size
        cursor = f"{self.token}:{next_offset}" if next_offset < len(values) else None
        return Page(tuple({"post_id": value} for value in chunk), cursor)


def compare_mock(limit: int) -> dict:
    ids = list(range(30, 0, -1))
    a, b = MockSearch("token-a", ids), MockSearch("token-b", ids)
    sequential = collect_sequential(a.first, a.follow, limit)
    split = collect_even_odd_unsafe((a.first, b.first), (a.follow, b.follow), limit)
    expected = set(sequential.post_ids)
    actual = set(split.post_ids)
    return {
        "mode": "deterministic-mock",
        "sequential": sequential.report(),
        "even_odd": split.report(),
        "missing_post_ids": sorted(expected - actual, reverse=True),
        "extra_post_ids": sorted(actual - expected, reverse=True),
        "same_post_ids": expected == actual,
        "conclusion": "unsafe: links.next is an opaque window cursor and cannot be split by page parity",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = compare_mock(args.limit)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not report["same_post_ids"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
