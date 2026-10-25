// A reference adapter for the Desk (desk.events/1). It reads a made-up tool's usage log, one JSON object per line:
//   {"acme_usage":1,"id":"u-001","at":"2026-10-20T10:00:03Z","session":"acme-s1","model":"claude-opus-5","in":1200,"out":340,"cached_in":800,"cwd":"/work/shop","tools":["Bash"],"cost_usd":0.02}
// An adapter is two pure functions. It has no clock, no randomness, no network and no access to any file but its own folder; the Desk runs it in a sandbox that enforces that.
// It says what it skipped, in notes, and never skips quietly.

const MICROS_PER_USD = 1_000_000;

export default {
  // True when the first bytes of a file are this tool's. It must say false for anything else, or the adapter is not loaded.
  detect(head) {
    const first = head.split(/\r?\n/).find((l) => l.trim() !== "");
    if (first === undefined) return false;
    try {
      const o = JSON.parse(first);
      return o !== null && typeof o === "object" && o.acme_usage === 1;
    } catch {
      return false;
    }
  },

  // Turn a whole file into { sessions, calls, notes }. The Desk writes the header and checks every record against desk.events/1.
  parse(text) {
    const sessions = new Map();
    const calls = [];
    const notes = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.trim() === "") return;
      const at = `line ${index + 1}`;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        // A last line the tool was still writing, or damage. Said, not hidden.
        notes.push(`${at}: not JSON, skipped`);
        return;
      }
      if (o === null || typeof o !== "object" || o.acme_usage !== 1) {
        notes.push(`${at}: not a usage record, skipped`);
        return;
      }
      if (typeof o.error === "string") {
        // A failed request has no tokens to count; it is kept as a call with its error marked, so the failure is on the record.
        calls.push({ call_id: o.id, session_id: o.session, ts: o.at, model: o.model, input_tokens: o.in ?? 0, output_tokens: o.out ?? 0, is_api_error: true });
      } else {
        const call = { call_id: o.id, session_id: o.session, ts: o.at, model: o.model, input_tokens: o.in, output_tokens: o.out };
        if (typeof o.cached_in === "number") call.cache_read_tokens = o.cached_in;
        if (Array.isArray(o.tools)) call.tool_names = o.tools;
        if (typeof o.cost_usd === "number") {
          call.reported_cost_micros = Math.round(o.cost_usd * MICROS_PER_USD);
          call.reported_currency = "USD";
        }
        calls.push(call);
      }
      if (!sessions.has(o.session)) sessions.set(o.session, { session_id: o.session, ...(typeof o.cwd === "string" ? { project_path: o.cwd } : {}) });
    });
    return { sessions: [...sessions.values()], calls, notes };
  },
};
