#!/usr/bin/env bash
# Serve the synthetic team roster as a small JSON REST endpoint on the Zetaris Docker network.
# Run inside WSL from the repository root:  bash infra/silos/start-roster-silo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
if docker ps -a --format '{{.Names}}' | grep -qx desk-silo-roster; then
  docker start desk-silo-roster >/dev/null
else
  docker run -d --name desk-silo-roster --network zetaris_default -v "$PWD/infra/silos/roster:/srv:ro" -w /srv \
    python:3.12-alpine python -m http.server 8080 >/dev/null
fi
echo "roster silo ready at http://desk-silo-roster:8080/roster.json (inside the Zetaris network)"
