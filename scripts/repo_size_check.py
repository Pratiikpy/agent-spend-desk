#!/usr/bin/env python3
"""Keep the repository light, as the organizers require.

Fails when a committable file is larger than the limit or looks like a raw
archive, model checkpoint, or media dump. Gitignored organizer material (docs/event/), the local ledger (data/desk/) and
third-party clones (research/) are skipped.

Usage: python scripts/repo_size_check.py [--limit-kb 1024]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", "logs", "dist", "build"}
SKIP_PREFIXES = ("docs/event/", "research/", "data/desk/")
SUSPECT_SUFFIXES = {
    ".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".parquet", ".bin", ".pt", ".pth",
    ".safetensors", ".ckpt", ".onnx", ".gguf", ".mp4", ".mov", ".avi", ".wav", ".mp3", ".db", ".sqlite",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-kb", type=int, default=1024, help="per-file size limit in KB (default 1024)")
    args = parser.parse_args()
    limit = args.limit_kb * 1024

    problems: list[str] = []
    total = 0
    # Prune skipped directories during the walk; enumerating research/ and node_modules/ first is slow.
    for current, dirnames, filenames in os.walk(ROOT):
        current_rel = Path(current).relative_to(ROOT).as_posix()
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS
            and not (f"{current_rel}/{d}/" if current_rel != "." else f"{d}/").startswith(SKIP_PREFIXES)
        ]
        for name in filenames:
            path = Path(current) / name
            rel = path.relative_to(ROOT)
            try:
                size = path.stat().st_size
            except OSError:
                continue
            total += size
            if size > limit:
                problems.append(f"{rel.as_posix()}: {size // 1024} KB exceeds {args.limit_kb} KB")
            elif path.suffix.lower() in SUSPECT_SUFFIXES:
                problems.append(f"{rel.as_posix()}: {path.suffix} files do not belong in the repo (use a sample or a download script)")

    print(f"Scanned committable tree: {total / 1024:.0f} KB total.")
    for item in problems:
        print(item)
    if problems:
        print(f"\nFAIL: {len(problems)} problem(s).", file=sys.stderr)
        return 1
    print("OK: repository is light.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
