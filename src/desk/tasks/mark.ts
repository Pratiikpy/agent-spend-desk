// The Claude Code SessionStart hook: records the label a wrapper put in DESK_TASK, and prints nothing.
// Whatever a SessionStart hook prints goes into the session's context, so this must stay silent. Node built-ins only, to start fast.
import { defaultMarkerPath, markFromEnv } from "./markers.ts";

try {
  markFromEnv(defaultMarkerPath(), process.cwd(), new Date().toISOString());
} catch {
  /* a label that cannot be written must not disturb the session */
}
