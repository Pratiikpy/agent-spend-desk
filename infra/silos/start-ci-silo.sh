#!/usr/bin/env bash
# Start the synthetic CI and pull-request silo (Postgres) on the Zetaris Docker network and load
# the seed rows. Run inside WSL from the repository root:  bash infra/silos/start-ci-silo.sh
# The password is read from .env (DESK_SILO_PG_PASSWORD) at run time and is never printed.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
: "${DESK_SILO_PG_PASSWORD:?DESK_SILO_PG_PASSWORD is missing from .env}"

if docker ps -a --format '{{.Names}}' | grep -qx desk-silo-ci; then
  docker start desk-silo-ci >/dev/null
else
  docker run -d --name desk-silo-ci --network zetaris_default \
    -e POSTGRES_USER=desk -e POSTGRES_PASSWORD="$DESK_SILO_PG_PASSWORD" -e POSTGRES_DB=desk_ci \
    postgres:16-alpine >/dev/null
fi
until docker exec desk-silo-ci pg_isready -U desk -d desk_ci >/dev/null 2>&1; do sleep 1; done
docker exec -i desk-silo-ci psql -q -U desk -d desk_ci < infra/silos/ci-seed.sql
echo "ci silo ready"
