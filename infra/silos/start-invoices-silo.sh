#!/usr/bin/env bash
# Start the synthetic provider-invoice silo: an S3-compatible bucket (Adobe S3Mock) on the Zetaris Docker network,
# loaded with the invoice CSV files from a directory. Run inside WSL from the repository root:
#   bash infra/silos/start-invoices-silo.sh [directory-with-invoice-files]
# The directory holds one sub-directory per vendor and month, for example anthropic/2026-09/invoice-lines.csv; every
# file becomes an object under the same key in the bucket desk-invoices. Without an argument the small committed
# example in infra/silos/invoices is loaded.
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC="${1:-infra/silos/invoices}"
[ -d "$SRC" ] || { echo "no such directory: $SRC" >&2; exit 2; }

if docker ps -a --format '{{.Names}}' | grep -qx desk-silo-invoices; then
  docker start desk-silo-invoices >/dev/null
else
  docker run -d --name desk-silo-invoices --network zetaris_default -p 127.0.0.1:19090:9090 \
    -e COM_ADOBE_TESTING_S3MOCK_INITIAL_BUCKETS=desk-invoices \
    adobe/s3mock:latest >/dev/null
fi
until curl -sS -o /dev/null -X PUT http://127.0.0.1:19090/desk-invoices 2>/dev/null; do sleep 1; done
count=0
while IFS= read -r -d '' f; do
  key="${f#"$SRC"/}"
  curl -fsS -o /dev/null -T "$f" "http://127.0.0.1:19090/desk-invoices/$key"
  count=$((count + 1))
done < <(find "$SRC" -type f -name '*.csv' -print0)
echo "invoice silo ready: $count files in s3a://desk-invoices/ (inside the Zetaris network: http://desk-silo-invoices:9090)"
