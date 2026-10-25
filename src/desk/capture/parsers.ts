/**
 * Reading what a test run said, one result per test (DF-036). A task made from history is only as good as the list of tests that decide it, so each reader keeps the identity of a
 * test stable between two runs in two different folders: the file it lives in, relative to the folder the run was made in, then the names of the groups around it, then its own
 * name. A run that could not load a file at all is one failing entry for that file, never silence, because "the tests did not run" must not read as "no test failed".
 */
export type TestStatus = "pass" | "fail" | "skip";

export interface TestResult {
  id: string;
  status: TestStatus;
  /** What the runner said was wrong, for a failing test, when it said: the first lines of its message. Never used to tell two results apart. */
  detail?: string;
}

export type ResultFormat = "junit" | "tap" | "json" | "exit";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1] as string] = decode(m[2] as string);
  return out;
}

/** A path from a result, made relative to the folder the run was made in, with forward slashes. A path outside the folder is kept whole. */
export function relativePath(path: string, root: string): string {
  const p = path.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const lower = process.platform === "win32" || /^[a-z]:\//i.test(r);
  const head = p.slice(0, r.length + 1);
  const matches = lower ? head.toLowerCase() === `${r.toLowerCase()}/` : head === `${r}/`;
  return matches ? p.slice(r.length + 1) : p;
}

/** JUnit XML, as written by node's test runner (`--test-reporter=junit`), pytest (`--junitxml`) and most others. Groups are nested `testsuite` elements. */
export function parseJunit(xml: string, root: string, o: { nodeQuotes?: boolean } = {}): TestResult[] {
  const out: TestResult[] = [];
  const stack: string[] = [];
  type Open = { name: string; file: string; status: TestStatus; suites: string[]; detail?: string };
  let current: Open | null = null;
  const tag = /<(\/?)(testsuite|testcase|failure|error|skipped)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  // Node's reporter escapes a quote twice (`&amp;quot;`), so a name with a quote in it reads back with the entity still in it. The repair is for its output only: in anyone else's
  // a name that really says `&quot;` would be changed.
  const fix = (x: string): string => (o.nodeQuotes ? x.replace(/&quot;/g, '"') : x);
  const push = (c: Open): void => {
    const file = c.file === "" ? "" : `${relativePath(c.file, root)}::`;
    out.push({ id: `${file}${[...c.suites, c.name].map(fix).join(" > ")}`, status: c.status, ...(c.detail ? { detail: c.detail } : {}) });
  };
  for (const m of xml.matchAll(tag)) {
    const closing = m[1] === "/";
    const name = m[2] as string;
    const selfClosing = m[4] === "/";
    const a = attrs(m[3] as string);
    if (name === "testsuite") {
      if (closing) stack.pop();
      else if (!selfClosing) {
        // A suite named for a file is the file, not a group inside it: its testcases carry the path themselves.
        stack.push(a["name"] ?? "");
      }
    } else if (name === "testcase") {
      if (closing) {
        if (current) push(current);
        current = null;
      } else {
        const file = a["file"] ?? "";
        const isFileSuite = (n: string): boolean => /[\\/]/.test(n) || /\.(test|spec)\.[a-z]+$/i.test(n);
        const suites = stack.filter((s) => s !== "" && !isFileSuite(s) && s !== "pytest");
        const c: Open = { name: a["name"] ?? "", file, status: "pass", suites };
        if (selfClosing) push(c);
        else current = c;
      }
    } else if (!closing && current) {
      if (name === "failure" || name === "error") {
        current.status = "fail";
        const message = a["message"];
        if (message && !current.detail) current.detail = message.slice(0, 400);
      }
      else if (name === "skipped" && current.status !== "fail") current.status = "skip";
    }
  }
  return out;
}

/**
 * TAP, as written by node's runner (`--test-reporter=tap`), bats and others. Nested tests are indented under a `# Subtest:` line and their parent's own line comes after them,
 * summarising them; only the leaves are results. TAP has no file name, so a run of several files can repeat an id; the caller is told so by the run, not by this.
 */
export function parseTap(text: string): TestResult[] {
  const out: TestResult[] = [];
  const names: { indent: number; name: string }[] = [];
  const lines = text.split(/\r?\n/);
  const point = /^(\s*)(not ok|ok)\s+\d+\s*(?:-\s*)?(.*)$/;
  const sub = /^(\s*)#\s*Subtest:\s*(.*)$/;
  // The indentation of each `# Subtest:` line not yet closed by its own summary point: a point with deeper ones open summarises them and is not a result itself.
  const deepest: number[] = [];
  for (const line of lines) {
    const s = sub.exec(line);
    if (s) {
      const indent = (s[1] as string).length;
      names.push({ indent, name: (s[2] as string).trim() });
      deepest.push(indent);
      continue;
    }
    const m = point.exec(line);
    if (!m) continue;
    const indent = (m[1] as string).length;
    const ok = m[2] === "ok";
    let desc = (m[3] as string).trim();
    let status: TestStatus = ok ? "pass" : "fail";
    const directive = /\s+#\s*(SKIP|TODO)\b.*$/i.exec(desc);
    if (directive) {
      if ((directive[1] as string).toUpperCase() === "SKIP") status = "skip";
      desc = desc.slice(0, directive.index).trim();
    }
    // This point closes the subtest of its own level, and any deeper ones left open.
    const children = deepest.some((d) => d > indent);
    while (names.length > 0 && (names[names.length - 1] as { indent: number }).indent >= indent) names.pop();
    for (let i = deepest.length - 1; i >= 0; i -= 1) if ((deepest[i] as number) > indent) deepest.pop();
    if (children) continue;
    out.push({ id: [...names.map((n) => n.name), desc].filter(Boolean).join(" > "), status });
  }
  return out;
}

interface JsonAssertion {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status?: string;
  failureMessages?: string[];
}
interface JsonFile {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: JsonAssertion[];
}

/** The JSON report of jest, and of vitest's `--reporter=json`, which has the same shape. */
export function parseJsonReport(text: string, root: string): TestResult[] {
  const doc = JSON.parse(text) as { testResults?: JsonFile[] };
  const out: TestResult[] = [];
  for (const f of doc.testResults ?? []) {
    const file = relativePath(f.name ?? "", root);
    const cases = f.assertionResults ?? [];
    if (cases.length === 0 && f.status === "failed") out.push({ id: `${file}::(the file did not run)`, status: "fail" });
    for (const c of cases) {
      const name = c.fullName ?? [...(c.ancestorTitles ?? []), c.title ?? ""].join(" ");
      const status: TestStatus = c.status === "passed" ? "pass" : c.status === "failed" ? "fail" : "skip";
      const detail = status === "fail" ? c.failureMessages?.find((m) => typeof m === "string" && m !== "") : undefined;
      out.push({ id: `${file}::${name}`, status, ...(detail ? { detail: detail.slice(0, 400) } : {}) });
    }
  }
  return out;
}

/** A command that says only whether it succeeded: one result for the whole command, which makes any task made from it a weak oracle. */
export function parseExit(code: number | null): TestResult[] {
  return [{ id: "(the test command)", status: code === 0 ? "pass" : "fail" }];
}

export function parseResults(format: ResultFormat, o: { text: string; root: string; exitCode: number | null; nodeQuotes?: boolean }): TestResult[] {
  if (format === "junit") return parseJunit(o.text, o.root, o.nodeQuotes ? { nodeQuotes: true } : {});
  if (format === "tap") return parseTap(o.text);
  if (format === "json") return parseJsonReport(o.text, o.root);
  return parseExit(o.exitCode);
}

/** A test that appears twice under one id is reported once, failing if it failed anywhere, so that the sets compared later have one entry per test. */
export function dedupe(results: readonly TestResult[]): Map<string, TestStatus> {
  const rank: Record<TestStatus, number> = { skip: 0, pass: 1, fail: 2 };
  const m = new Map<string, TestStatus>();
  for (const r of results) {
    const prior = m.get(r.id);
    if (prior === undefined || rank[r.status] > rank[prior]) m.set(r.id, r.status);
  }
  return m;
}
