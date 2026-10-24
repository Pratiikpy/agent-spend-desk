// Update one row of the feature status table without disturbing the others.
//   node scripts/set-feature.mjs DF-030 built "src/a.ts,tests/a.test.ts" "what is still missing, or empty"
// A feature marked built may still name a limit in "missing": that is the place for a decision not to build a part.
// tests/desk/feature-status.test.ts checks the result; `desk status write` turns it into docs/design/desk/07-feature-status.md.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "docs/design/desk/feature-status.json";
const [id, status, evidence = "", missing = ""] = process.argv.slice(2);
if (!/^DF-\d{3}$/.test(id ?? "") || !["built", "partial", "absent"].includes(status ?? "")) {
  console.error('Use: node scripts/set-feature.mjs DF-nnn built|partial|absent "file,file" "what is missing"');
  process.exit(2);
}

const doc = JSON.parse(readFileSync(FILE, "utf8"));
const row = doc.features.find((f) => f.id === id);
if (!row) {
  console.error(`${id} is not in ${FILE}`);
  process.exit(1);
}
row.status = status;
row.evidence = evidence === "" ? [] : evidence.split(",").map((s) => s.trim());
row.missing = missing;

const line = (f) => `    { "id": ${JSON.stringify(f.id)}, "status": ${JSON.stringify(f.status)}, "evidence": [${f.evidence.map((e) => JSON.stringify(e)).join(", ")}], "missing": ${JSON.stringify(f.missing)} }`;
const text = [
  "{",
  `  "asOf": ${JSON.stringify(new Date().toISOString().slice(0, 10))},`,
  `  "method": ${JSON.stringify(doc.method)},`,
  '  "features": [',
  doc.features.map(line).join(",\n"),
  "  ]",
  "}",
  "",
].join("\n");
writeFileSync(FILE, text);
console.log(`${id}: ${status}`);
