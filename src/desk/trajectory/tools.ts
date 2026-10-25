/**
 * What a tool call can do to the world, decided before anything is replayed (DF-040, DF-041). A replay must never fire a side effect twice: a `git push` that was recorded must
 * not be sent again because a different model asked for it. Every call is put in one of two classes, and the rule for the doubtful ones is fixed: a tool the Desk does not know,
 * and a shell command it cannot show to be harmless, are mutating.
 *
 * `read_only` calls may be run again against a sandbox copy of the workspace, or served from the recording; `mutating` calls are never run outside the sandbox. The effect says
 * what kind of change a mutating call makes, because one kind is safe inside a sandbox folder (writing a file there) and the others are not.
 */
export type ToolClass = "read_only" | "mutating";
export type Effect = "workspace_read" | "network_read" | "file_edit" | "shell" | "agent" | "unknown";

export interface ToolKind {
  class: ToolClass;
  effect: Effect;
  /** Why, in a few words: shown beside a call that was not run. */
  why: string;
}

// Claude Code's tool names, and the names other tools give theirs (Gemini CLI's built-ins, Codex's plan tool, and the plain names a tool offered through a gateway may use).
const READ_WORKSPACE = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "ExitPlanMode", "BashOutput", "read_file", "read_many_files", "list_directory", "glob", "search_file_content", "grep_search", "update_plan", "view_image"]);
const READ_NETWORK = new Set(["WebFetch", "WebSearch", "web_fetch", "google_web_search"]);
const EDIT = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Delete", "write_file", "replace", "apply_patch"]);
const AGENT = new Set(["Task", "Agent"]);

/** Commands that only read, by name. A command not here is not known to be harmless. */
const SAFE_COMMANDS = new Set([
  "ls", "dir", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "find", "pwd", "echo", "which", "where", "whoami", "date", "uname", "stat", "file", "du", "df", "tree", "sort", "uniq", "cut",
  "tr", "diff", "cmp", "basename", "dirname", "realpath", "readlink", "type", "hostname", "nl", "tac", "rev", "column", "fold", "expand", "md5sum", "sha1sum", "sha256sum", "true", "false", "test", "[", "cd",
]);
const SAFE_GIT = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "ls-tree", "cat-file", "blame", "describe", "shortlog", "rev-list", "name-rev", "show-ref", "for-each-ref", "merge-base", "grep", "count-objects", "check-ignore", "whatchanged"]);
const FIND_WRITES = /^-(exec|execdir|ok|okdir|delete|fprint|fprintf|fprint0|fls)$/;

/** Split a shell line into command segments and reject anything that could run or write something else. Returns null when the line cannot be shown to be a plain read. */
function segments(raw: string): string[][] | null {
  // Sending a command's errors to its output (`2>&1`) or either of them to the bit bucket (`2>/dev/null`, `&>/dev/null`) writes nothing anywhere, and nearly every shell line an
  // agent writes has one. Any other redirect writes a file.
  const line = raw.replace(/(?:&|\d)?>>?\s*\/dev\/null/g, " ").replace(/\d>&\d/g, " ");
  const out: string[][] = [];
  let cur: string[] = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  const endWord = (): void => {
    if (inWord) cur.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = (): void => {
    endWord();
    if (cur.length > 0) out.push(cur);
    cur = [];
  };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] as string;
    const next = line[i + 1];
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "`" || (c === "$" && (next === "(" || next === "{"))) return null;
      else if (c === "\\" && next !== undefined) {
        word += next;
        i += 1;
      } else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      continue;
    }
    if (c === "`" || c === ">" || c === "<" || c === "(" || c === ")" || c === "{" || c === "}") return null;
    if (c === "$" && (next === "(" || next === "{")) return null;
    if (c === "\\") {
      if (next === undefined) return null;
      word += next;
      inWord = true;
      i += 1;
      continue;
    }
    if (c === "&") {
      if (next === "&") {
        endSegment();
        i += 1;
        continue;
      }
      return null; // a command sent to the background, or a redirect of both outputs
    }
    if (c === "|") {
      endSegment();
      if (next === "|") i += 1;
      continue;
    }
    if (c === ";" || c === "\n" || c === "\r") {
      endSegment();
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      continue;
    }
    word += c;
    inWord = true;
  }
  if (quote !== null) return null;
  endSegment();
  return out;
}

/** True when a shell line is a plain read: every command in it is on the list, none redirects, expands a substitution, runs a background job, or writes through a flag. */
export function isReadOnlyShell(command: string): boolean {
  const segs = segments(command);
  if (segs === null || segs.length === 0) return false;
  for (const seg of segs) {
    const name = seg[0] as string;
    if (/[/\\]/.test(name) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) return false;
    const args = seg.slice(1);
    if (name === "git") {
      const sub = args.find((a) => !a.startsWith("-"));
      if (args.some((a) => a === "--output" || a.startsWith("--output=") || a === "-o")) return false;
      if (sub !== undefined && SAFE_GIT.has(sub)) continue;
      // `git branch` with no argument, `git remote -v`, `git tag` and `git stash list` read; each other form of them can write.
      const ok =
        (sub === "branch" && args.every((a) => a === "branch" || ["-a", "-r", "-v", "-vv", "--list", "--all", "--show-current"].includes(a))) ||
        (sub === "remote" && args.every((a) => a === "remote" || a === "-v" || a === "show")) ||
        (sub === "tag" && args.every((a) => a === "tag" || a === "-l" || a === "--list")) ||
        (sub === "stash" && args.join(" ") === "stash list") ||
        (sub === "config" && args.some((a) => ["--get", "--get-all", "--list", "-l"].includes(a)) && !args.some((a) => ["--unset", "--add", "--replace-all"].includes(a))) ||
        (sub === "reflog" && args.every((a) => !["expire", "delete"].includes(a)));
      if (!ok) return false;
      continue;
    }
    if (!SAFE_COMMANDS.has(name)) return false;
    if (name === "find" && args.some((a) => FIND_WRITES.test(a))) return false;
    if (name === "sort" && args.some((a) => a === "-o" || a.startsWith("--output"))) return false;
    if (name === "tree" && args.some((a) => a === "-o")) return false;
  }
  return true;
}

export function classifyTool(name: string, input: unknown, overrides: ReadonlyMap<string, ToolKind> = new Map()): ToolKind {
  const own = overrides.get(name);
  if (own) return own;
  if (READ_WORKSPACE.has(name)) return { class: "read_only", effect: "workspace_read", why: "reads the workspace" };
  if (READ_NETWORK.has(name)) return { class: "read_only", effect: "network_read", why: "reads from the network, which gives a different answer each time" };
  if (EDIT.has(name)) return { class: "mutating", effect: "file_edit", why: "writes a file" };
  if (AGENT.has(name)) return { class: "mutating", effect: "agent", why: "starts another agent, which can do anything this one can" };
  if (name === "Bash" || name === "PowerShell" || name === "Shell" || name === "run_shell_command" || name === "shell") {
    // Codex's shell tool gives the command as a list of words.
    const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>)["command"] : undefined;
    const command = typeof raw === "string" ? raw : Array.isArray(raw) && raw.every((w) => typeof w === "string") ? (raw as string[]).join(" ") : "";
    return isReadOnlyShell(command)
      ? { class: "read_only", effect: "workspace_read", why: "a shell command that only reads" }
      : { class: "mutating", effect: "shell", why: "a shell command that cannot be shown to only read" };
  }
  return { class: "mutating", effect: "unknown", why: "a tool the Desk does not know, so it is taken to change something" };
}
