#!/usr/bin/env node
// desk-verify: check a dossier folder offline. Reads the folder and a pins file; touches nothing else.
import { readFileSync } from "node:fs";

import { exitCode, formatReport } from "./report.ts";
import { BundleReadError, readBundleDir } from "./read-dir.ts";
import { PinsError, verifyBundle } from "./verify.ts";

const USAGE = "Usage: desk-verify <bundle-folder> [--pins <pins.json>] [--json]\n  exit 0 PASS, 1 FAIL, 3 INDETERMINATE, 2 usage or unreadable input";

export function run(argv: readonly string[], out: (line: string) => void = (l) => process.stdout.write(l + "\n")): number {
  const args = [...argv];
  let pinsPath: string | undefined;
  let asJson = false;
  const positional: string[] = [];
  while (args.length > 0) {
    const a = args.shift() as string;
    if (a === "--pins") pinsPath = args.shift();
    else if (a === "--json") asJson = true;
    else if (a.startsWith("--")) {
      out(`unknown option ${a}\n${USAGE}`);
      return 2;
    } else positional.push(a);
  }
  if (positional.length !== 1 || (pinsPath === undefined && argv.includes("--pins"))) {
    out(USAGE);
    return 2;
  }
  let pins: unknown;
  if (pinsPath !== undefined) {
    try {
      pins = JSON.parse(readFileSync(pinsPath, "utf8"));
    } catch {
      out(`cannot read pins from ${pinsPath}`);
      return 2;
    }
  }
  let files;
  try {
    files = readBundleDir(positional[0] as string);
  } catch (e) {
    out(e instanceof BundleReadError ? e.message : `cannot read ${positional[0]}`);
    return 2;
  }
  try {
    const report = verifyBundle(files, pins === undefined ? {} : { pins });
    out(asJson ? JSON.stringify(report, null, 2) : formatReport(report, positional[0] as string));
    return exitCode(report);
  } catch (e) {
    if (e instanceof PinsError) {
      out(`pins file is not valid: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

if (process.argv[1] && /main\.(ts|js)$/.test(process.argv[1].replaceAll("\\", "/"))) process.exitCode = run(process.argv.slice(2));
