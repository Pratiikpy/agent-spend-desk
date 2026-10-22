#!/usr/bin/env bash
# Load the three synthetic silos with the seed files that `desk silos seed` derived from the constructed sample,
# and register the invoice file with Zetaris. Run inside WSL from the repository root, after the three silo
# containers exist (start-ci-silo.sh, start-roster-silo.sh, start-invoices-silo.sh):
#   bash infra/silos/load-sample-silos.sh data/desk/sample/silos
set -euo pipefail
cd "$(dirname "$0")/../.."
DIR="${1:?usage: load-sample-silos.sh <silos-directory>}"
for f in "$DIR/ci-seed.sql" "$DIR/invoices/sample/invoice-lines.csv" "$DIR/roster/roster.json"; do
  [ -f "$f" ] || { echo "missing $f (run: desk silos seed)" >&2; exit 2; }
done

docker exec -i desk-silo-ci psql -q -U desk -d desk_ci < "$DIR/ci-seed.sql"
echo "ci silo: $(docker exec desk-silo-ci psql -At -U desk -d desk_ci -c 'select count(*) from pull_requests') pull requests"

curl -fsS -o /dev/null -T "$DIR/invoices/sample/invoice-lines.csv" "http://127.0.0.1:19090/desk-invoices/sample/invoice-lines.csv"
echo "invoice silo: sample/invoice-lines.csv uploaded"

docker rm -f desk-silo-roster >/dev/null 2>&1 || true
docker run -d --name desk-silo-roster --network zetaris_default -v "$PWD/$DIR/roster:/srv:ro" -w /srv python:3.12-alpine python -m http.server 8080 >/dev/null
echo "roster silo: restarted on $DIR/roster"

# Register the sample invoice file as a table once. The option names are the ones Zetaris stored for the first invoice
# table (path, header, inferSchema, isS3BucketPublic, s3Endpoint, useS3PathStyleAccess); a second run reports that it exists.
python3 scripts/zetaris.py "CREATE LIGHTNING FILESTORE TABLE lines_sample FROM desk_invoices FORMAT CSV OPTIONS (path \"s3a://desk-invoices/sample/invoice-lines.csv\", header \"true\", inferSchema \"true\", isS3BucketPublic \"true\", s3Endpoint \"http://desk-silo-invoices:9090\", useS3PathStyleAccess \"true\")" || true
