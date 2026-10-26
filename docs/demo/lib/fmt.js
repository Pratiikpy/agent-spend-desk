// Number and date formatting. Money arrives as integer micro-dollars and is only formatted here.
export function usd(micros, opts = {}) {
  if (micros === null || micros === undefined || Number.isNaN(micros)) return "n/a";
  const dollars = micros / 1_000_000;
  const abs = Math.abs(dollars);
  const digits = opts.cents === false || abs >= 1000 ? 0 : 2;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(share, digits) {
  if (share === null || share === undefined || Number.isNaN(share)) return "n/a";
  const p = share * 100;
  const d = digits ?? (p > 0 && p < 10 ? 1 : 0);
  return `${p.toFixed(d)}%`;
}

export function int(n) {
  return Number(n).toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function timeLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function stamp(iso) {
  return `${dayLabel(iso)}, ${timeLabel(iso)}`;
}

export function duration(sec) {
  if (sec < 90) return `${Math.round(sec)} s`;
  const m = sec / 60;
  if (m < 90) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export const STATE_LABEL = {
  kept: "Kept",
  merged: "Merged",
  committed: "Committed",
  reverted: "Reverted",
  unlinked: "Unlinked",
};

export const STATE_NOTE = {
  kept: "Merged and still there after 7 days",
  merged: "Merged, not yet 7 days old",
  committed: "Committed, not merged",
  reverted: "Reverted: the work was undone",
  unlinked: "No commit can be tied to it from these sources. Unknowable, not waste.",
};

export const CAUSE_LABEL = {
  idle: "Idle and background work",
  loops: "Loops (same call repeated)",
  subagents: "Sub-agents",
  tool_output: "Tool output sent back",
  cache_misses: "Cache misses",
  reasoning: "Reasoning",
  history_rereads: "Re-reading the conversation",
  new_work: "New work",
  cache_miss: "Cache miss",
  ordinary: "Ordinary call",
};
