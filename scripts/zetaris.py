"""Small helper for the local Zetaris REST route (verified 2026-10-16/22). Reads settings from .env, never prints secrets.

  python scripts/zetaris.py "SQL statement"     one statement, no trailing semicolon (Zetaris rule)
"""
import json
import sys
import urllib.request
import uuid
from pathlib import Path


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (Path(__file__).resolve().parent.parent / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def run(sql: str, limit: int = 100, env: dict[str, str] | None = None) -> tuple[int, object]:
    env = env or load_env()
    body = {"queryId": str(uuid.uuid4()), "sql": sql, "source": "SqlEditor", "limit": limit}
    req = urllib.request.Request(
        env["ZETARIS_REST_URL"].rstrip("/") + "/sql-editor/sqls/run",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + env["ZETARIS_API_KEY"],
            "X-Org-ID": env["ZETARIS_ORG_ID"],
            "X-Request-ID": str(uuid.uuid4()),
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:800].decode("utf-8", "replace")


if __name__ == "__main__":
    status, data = run(sys.argv[1])
    secrets = [v for k, v in load_env().items() if ("PASSWORD" in k or k.endswith("API_KEY")) and v]
    text = json.dumps(data, ensure_ascii=False)
    for s in secrets:
        text = text.replace(s, "***")
    print(status, text[:2000])
