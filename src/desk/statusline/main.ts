// The status line command: Claude Code runs this and sends session JSON on stdin; it prints one gauge line.
// Node built-ins only, so that it starts quickly. It never fails loudly: a status line that errors would clutter the session.
import { readFileSync } from "node:fs";

import { gaugeCachePath, gaugeSuffix } from "../gauge/watch.ts";
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
    // The burn rate and the biggest cause come from the gauge's cache, which `desk gauge --watch` keeps fresh; without it the line is as before.
    const extra = gaugeSuffix(gaugeCachePath(), now.getTime());
    process.stdout.write(`${gauge(sample, now)}${extra === null ? "" : ` · ${extra}`}\n`);
  }
} catch {
  /* unreadable input: print nothing */
}
