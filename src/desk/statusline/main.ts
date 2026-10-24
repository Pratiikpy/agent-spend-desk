// The status line command: Claude Code runs this and sends session JSON on stdin; it prints one gauge line.
// Node built-ins only, so that it starts quickly. It never fails loudly: a status line that errors would clutter the session.
import { readFileSync } from "node:fs";

import { gauge, parseStatusline, recordSample, statuslineLogPath } from "./statusline.ts";

try {
  const now = new Date();
  const sample = parseStatusline(JSON.parse(readFileSync(0, "utf8")) as unknown, now);
  if (sample) {
    try {
      recordSample(statuslineLogPath(), sample);
    } catch {
      /* a log that cannot be written must not stop the gauge */
    }
    process.stdout.write(`${gauge(sample, now)}\n`);
  }
} catch {
  /* unreadable input: print nothing */
}
