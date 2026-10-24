#!/usr/bin/env python3
"""Scan the repository for committed secrets and personal paths.

Usage:
    python scripts/secret_scan.py             # working tree
    python scripts/secret_scan.py --history   # also every blob in git history
    python scripts/secret_scan.py --stdin     # scan text from stdin (used by hooks)

Exit status 0 when clean, 1 when anything is found. Matches are printed with the
file, line number and rule name, never with the matched secret itself.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", "dist", "build", ".next", "logs",
}
# Gitignored material is never published: organizer docs, third-party reference clones and the local Desk ledger, the Lab work folder and generated samples.
SKIP_PATH_PREFIXES = ("docs/event/", "research/", "data/desk/", "data/lab/")
SKIP_SUFFIXES = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mov", ".zip",
    ".gz", ".tar", ".parquet", ".bin", ".pt", ".pth", ".safetensors", ".ico",
}
MAX_BYTES = 2_000_000

PLACEHOLDER = re.compile(
    r"(your|example|placeholder|changeme|change-me|replace|dummy|sample|redacted|xxx|<[^>]+>|\.\.\.)",
    re.IGNORECASE,
)

RULES: list[tuple[str, re.Pattern[str]]] = [
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private-key-block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("openai-style-key", re.compile(r"\bsk-[A-Za-z0-9_-]{32,}\b")),
    ("slack-token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("nvidia-api-key", re.compile(r"\bnvapi-[A-Za-z0-9_-]{30,}\b")),
    ("huggingface-token", re.compile(r"\bhf_[A-Za-z0-9]{30,}\b")),
    ("bearer-token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{30,}")),
    (
        "assigned-secret",
        re.compile(
            r"""(?ix)
            \b(?:api[_-]?key|secret|token|passw(?:or)?d|auth[_-]?key|access[_-]?key)\b
            \s*[:=]\s*
            ['"]?([A-Za-z0-9/+_\-]{20,})['"]?
            """
        ),
    ),
    ("personal-windows-path", re.compile(r"[A-Za-z]:[/\\]+Users[/\\]+[A-Za-z0-9_.-]+", re.IGNORECASE)),
    ("personal-path-flattened", re.compile(r"[A-Za-z]:_Users_[A-Za-z0-9.-]+_")),
    ("personal-unix-path", re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/")),
]


def scan_text(text: str, label: str) -> list[str]:
    """Return one finding string per match. Never includes the secret value."""
    findings: list[str] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for name, pattern in RULES:
            match = pattern.search(line)
            if not match:
                continue
            if name == "assigned-secret" and PLACEHOLDER.search(match.group(0)):
                continue
            findings.append(f"{label}:{lineno}: {name}")
    return findings


def iter_working_tree() -> list[Path]:
    files: list[Path] = []
    # Prune skipped directories during the walk: enumerating the whole of research/
    # and node_modules/ first made the scan take minutes.
    for current, dirnames, filenames in os.walk(ROOT):
        current_rel = Path(current).relative_to(ROOT).as_posix()
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS
            and not (f"{current_rel}/{d}/" if current_rel != "." else f"{d}/").startswith(SKIP_PATH_PREFIXES)
        ]
        for name in filenames:
            path = Path(current) / name
            if name == ".env":
                # Local secrets file: gitignored by design, so not a publication risk.
                continue
            if path.suffix.lower() in SKIP_SUFFIXES:
                continue
            try:
                if path.stat().st_size > MAX_BYTES:
                    continue
            except OSError:
                continue
            files.append(path)
    return files


def scan_working_tree() -> list[str]:
    findings: list[str] = []
    for path in iter_working_tree():
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError as exc:
            findings.append(f"{path.relative_to(ROOT).as_posix()}: unreadable ({exc.__class__.__name__})")
            continue
        findings.extend(scan_text(text, path.relative_to(ROOT).as_posix()))
    return findings


def scan_history() -> list[str]:
    if not (ROOT / ".git").exists():
        return ["history: no git repository yet, nothing to scan"]
    result = subprocess.run(
        ["git", "-C", str(ROOT), "log", "--all", "-p", "--no-color", "--format=commit %H"],
        capture_output=True, text=True, encoding="utf-8", errors="ignore", check=False,
    )
    if result.returncode != 0:
        return [f"history: git log failed ({result.stderr.strip()[:120]})"]
    findings: list[str] = []
    commit = "unknown"
    for line in result.stdout.splitlines():
        if line.startswith("commit "):
            commit = line.split()[1][:10]
            continue
        if not line.startswith("+") or line.startswith("+++"):
            continue
        for item in scan_text(line[1:], f"history@{commit}"):
            findings.append(item)
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--history", action="store_true", help="also scan every added line in git history")
    parser.add_argument("--stdin", action="store_true", help="scan text from stdin instead of the tree")
    args = parser.parse_args()

    if args.stdin:
        findings = scan_text(sys.stdin.read(), "stdin")
    else:
        findings = scan_working_tree()
        if args.history:
            findings += scan_history()

    real = [f for f in findings if "no git repository yet" not in f]
    for item in findings:
        print(item)
    if real:
        print(f"\nFAIL: {len(real)} finding(s). Remove or rotate, then rerun.", file=sys.stderr)
        return 1
    print("OK: no secrets or personal paths found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
