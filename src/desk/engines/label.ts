import { looksInstructionLike, WITHHELD } from "../security/injection.ts";

/**
 * Names that come out of a log (a model id, a tool version, a repository folder) are written by whatever
 * produced the log. Before one is shown or sent to a model it is cut down to plain characters, so a
 * newline, a backtick or a quote cannot end the quoted slot it sits in, and it is capped in length.
 */
const MAX = 60;

export function sanitizeLabel(raw: unknown, max = MAX): string {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  // A name that reads as an instruction is not passed on at all; the finding is kept in the ledger (`flagUntrustedText`).
  if (looksInstructionLike(text)) return WITHHELD;
  const cleaned = text
    .replace(/[^A-Za-z0-9._:@/+ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned === "" ? "unnamed" : cleaned;
}

/** The last path segment, for showing where a session ran without showing a home directory. */
export function folderName(path: string | null | undefined): string {
  if (!path) return "unknown";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return sanitizeLabel(parts[parts.length - 1] ?? "unknown");
}
