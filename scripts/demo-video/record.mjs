// Records the demo video from real runs: the terminal scenes replay the captured output of `desk demo` and
// friends line by line, the product scenes drive the real UI. Captions only; no voice.
//   npm i --no-save playwright-core && npx playwright-core install ffmpeg
//   node scripts/demo-video/record.mjs <out.mp4>      (needs Google Chrome and ffmpeg on the path)
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("This script needs playwright-core: npm i --no-save playwright-core && npx playwright-core install ffmpeg");
  process.exit(2);
}

const repo = resolve(import.meta.dirname, "..", "..");
const outMp4 = resolve(process.argv[2] ?? "desk-demo.mp4");
const work = join(repo, "data", "desk", "video-work");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const run = (args, env = {}) => {
  const r = spawnSync("npx", ["tsx", "src/desk/cli.ts", ...args], { cwd: repo, encoding: "utf8", shell: true, env: { ...process.env, SAMPLE_MODE: "true", NO_COLOR: "1", ...env }, maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout ?? "").replace(/\r/g, "");
};

// 1. The real output of the demo, split into its eight beats.
console.log("running desk demo ...");
const demoText = run(["demo"]);
const SEP = "-".repeat(78);
const beats = {};
{
  const parts = demoText.split(SEP + "\n");
  // parts: ["", "1/8  title\ncaption\n", "content", "2/8 ...", ...]
  for (let i = 1; i < parts.length; i += 2) {
    const head = parts[i].split("\n");
    const n = head[0].slice(0, 3);
    beats[n] = (parts[i + 1] ?? "").replace(/\n+$/, "").split("\n");
  }
}
const canaryText = run(["canary", "--sample"]).replace(/\n+$/, "").split("\n");
const benchOut = existsSync(join(repo, "docs/verification/benchmark/set-b/results.jsonl")) ? run(["bench", "report", "--sample", "--set", "B"]).replace(/\n+$/, "").split("\n") : null;

// 2. Static files for the player and a real UI server.
const staticServer = createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
  // Only the player and the fonts are served; the rest of the repository, .env included, is not.
  if (!/^\/(scripts\/demo-video\/player\.html|assets\/fonts\/[A-Za-z-]+\.ttf)$/.test(rel)) { res.writeHead(404); res.end(); return; }
  const p = join(repo, rel);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  const types = { ".html": "text/html", ".ttf": "font/ttf" };
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => staticServer.listen(8802, "127.0.0.1", r));

const ui = spawn("npx", ["tsx", "src/desk/cli.ts", "ui", "--sample", "--port", "8797"], { cwd: repo, shell: true, env: { ...process.env, SAMPLE_MODE: "true" } });
const uiUrl = await new Promise((resolve, reject) => {
  let buf = "";
  ui.stdout.on("data", (d) => { buf += d.toString(); const m = /http:\/\/127\.0\.0\.1:8797\/\?t=[a-f0-9]+/.exec(buf); if (m) resolve(m[0]); });
  setTimeout(() => reject(new Error("the UI did not start")), 120000);
});
console.log("ui at", uiUrl.replace(/t=.*/, "t=..."));

const CAP_CSS = `.capbar{position:fixed;left:64px;right:64px;bottom:36px;min-height:120px;padding:18px 28px;background:#0a0a0a;color:#fff;border-radius:14px;font:400 33px/1.3 Outfit,sans-serif;letter-spacing:-0.01em;display:flex;align-items:center;z-index:99999}`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--force-device-scale-factor=1"] });
const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1920, height: 1080 }, recordVideo: { dir: work, size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function player(fn, spec) {
  if (!page.url().startsWith("http://127.0.0.1:8802/")) await page.goto("http://127.0.0.1:8802/scripts/demo-video/player.html");
  await page.evaluate(([f, s]) => window[f](s), [fn, spec]);
}
async function caption(text) {
  await page.evaluate(([css, t]) => {
    if (!document.getElementById("capstyle")) { const s = document.createElement("style"); s.id = "capstyle"; s.textContent = css; document.head.appendChild(s); }
    let c = document.getElementById("capbar");
    if (!c) { c = document.createElement("div"); c.id = "capbar"; c.className = "capbar"; document.body.appendChild(c); }
    c.textContent = t;
    c.style.display = t ? "flex" : "none";
  }, [CAP_CSS, text]);
}
const toAnswer = () => page.evaluate(() => { const el = [...document.querySelectorAll(".sec")].find((e) => /^answer/i.test(e.innerText.trim())); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: "smooth" }); });
async function uiScene(hash, captions, hold, act) {
  await page.goto(uiUrl);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.evaluate(() => { document.documentElement.style.zoom = "1.3"; });
  await sleep(1500);
  const started = Date.now();
  let i = 0;
  const tick = async () => { while (i < captions.length && (Date.now() - started) / 1000 >= captions[i].t) { await caption(captions[i].text); i += 1; } };
  if (act) await act(tick);
  while ((Date.now() - started) / 1000 < hold) { await tick(); await sleep(250); }
}

const startedAt = Date.now();
const scenes = [];

// Captions are timed from their length, so each one stays up long enough to be read (about 2.7 words a second, plus a second).
const dur = (text) => Math.max(3.4, text.trim().split(/\s+/).length / 2.7 + 1.0);
const timed = (texts) => {
  let t = 0;
  const caps = texts.map((text) => { const c = { t: Number(t.toFixed(2)), text }; t += dur(text); return c; });
  return { caps, total: t };
};

const term = (spec) => {
  const { caps, total } = timed(spec.captions);
  const printed = spec.command.length / 38 + 0.35 + (spec.lines.length * (spec.lineMs ?? 70)) / 1000;
  scenes.push(() => player("play", { ...spec, captions: caps, hold: Math.max(2, total - printed + 0.6) }));
};
const card = (spec) => scenes.push(() => player("titleCard", spec));
const sponsors = (spec) => {
  const { caps, total } = timed(spec.captions);
  scenes.push(() => player("sponsors", { ...spec, captions: caps, hold: total + 0.6 }));
};
const uiShot = (hash, texts, act) => {
  const { caps, total } = timed(texts);
  scenes.push(() => uiScene(hash, caps, total + 0.6, act));
};
const scrollToSection = (label) => page.evaluate((l) => {
  const el = [...document.querySelectorAll(".sec")].find((e) => e.innerText.trim().toLowerCase().startsWith(l));
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
}, label);

card({
  h1: "Every dollar your agents spend, tied to work that landed.",
  lines: [
    "desk. is a local desk for the person who pays for AI coding agents: it explains the limit, checks the agent daily, tests a spend policy on a month it never saw, and signs what it concludes.",
    "Organisational data through Zetaris. Memory and history from Meterless engines. Every language role on NVIDIA Nemotron. Cursor is the required IDE.",
    "Open Agent Hackathon 2026 · Track 3, Reasoning Architecture",
  ],
  small: true,
  hold: 9,
  caption: "A constructed scenario. Every figure on screen comes from it, through the same code that reads your own logs.",
});

term({
  beat: "1/8", title: "Where did my limit go?", command: "npm run desk -- --sample", lines: beats["1/8"].slice(1), keys: ["Sub-agents", "could not know"], lineMs: 55,
  captions: [
    "Two hours in, the limit appears and I do not know why.",
    "desk. splits the heaviest window by cause and ranks the fixes worth making.",
    "It also says what it could not know. Unlinked work is unknowable, not waste.",
  ],
});

term({
  beat: "2/8", title: "The bill, through Zetaris", command: "npm run desk -- silos --sample", lines: beats["2/8"].filter((l) => !l.startsWith("  {") && l.trim() !== "trace"), keys: ["Bill classes", "CI facts"], lineMs: 90,
  captions: [
    "The bill is not in the logs: invoices in a bucket, CI in Postgres, a roster behind a service.",
    "One Zetaris statement joins the three. Invoices land 1.2% under my list-price estimate.",
    "And 60 landed sessions merged although the checks were red.",
  ],
});

uiShot("/canary", [
  "The canary runs a 52-task pack once a day on each arm. Here the primary arm's model was switched on day 15.",
  "The call comes with its interval, a flat control arm, and what it cannot say.",
], async (tick) => {
  const t1 = Date.now();
  while (Date.now() - t1 < 8000) { await tick(); await sleep(250); }
  await page.evaluate(() => window.scrollTo({ top: 640, behavior: "smooth" }));
});

term({
  beat: "4/8", title: "Propose, check, attack, then replay", command: "npm run desk -- propose --sample --dossier", lines: beats["4/8"], keys: ["HELD OUT", "narrows only", "attacker", "drafter"], lineMs: 75,
  captions: [
    "Nemotron drafts a cap policy. Code checks that it only narrows the one in force.",
    "An Attacker looks for requests that step around it. Then it meets a month it never saw.",
    "Five of 333 landed sessions would have been blocked. That is the headline, not the savings.",
  ],
});

uiShot("/ask", [
  "I ask a question. The Planner writes a typed program, code runs it read-only, the Auditor checks every figure.",
  "Switch the History engine off and ask again: the answer changes. That is proof it does something.",
], async (tick) => {
  await page.fill("input[type=text], input:not([type])", "What changed before 2026-10-15?");
  await tick();
  await page.keyboard.press("Enter");
  await sleep(5000);
  await toAnswer();
  await sleep(5000);
  await tick();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1200);
  const boxes = page.locator("input[type=checkbox]");
  if ((await boxes.count()) > 0) await boxes.first().check();
  await page.locator("input[type=text], input:not([type])").first().press("Enter");
  await sleep(5000);
  await toAnswer();
  await sleep(3000);
  await tick();
});

if (benchOut) {
  term({
    beat: "5/8", title: "Same model, three ways", command: "npm run desk -- bench report --sample --set B", lines: benchOut, keys: ["all  ", "exact \\(all", "pass\\^3", "correct abstention"], lineMs: 70,
    captions: [
      "Sixty questions it never saw, pre-registered: one call, a tool agent, and the Desk, all on the same Nemotron model.",
      "The Desk answered 49 exactly. The tool agent, 41. One call, 12. Eight questions in sixty is at the edge of what that shows.",
      "A fix found by reading the misses lifts the Desk to 54. It is shown as post hoc, beside the first figure.",
    ],
  });
}

uiShot("/evidence", [
  "The Desk also scores itself. Its 90% one-month range held the real month only 73% of the time.",
  "That is printed beside the range. So are link confidence, the regret ledger and what learning from mistakes moved.",
  "Two of sixty questions. The interval touches zero, so no improvement is claimed.",
], async (tick) => {
  await sleep(2500);
  await scrollToSection("calibration");
  await sleep(6500);
  await scrollToSection("decisions");
  await sleep(5000);
  await scrollToSection("learning");
});

term({
  beat: "6/8", title: "Approve, then verify offline", command: "npm run desk -- approve <request> <digest>", lines: beats["6/8"], keys: ["RESULT", "row_hash_mismatch"], lineMs: 70,
  captions: [
    "To apply the policy I echo the action digest. A dossier is signed with the rows its figures come from.",
    "A stranger verifies it on plain Node with the network off. Change one byte and it names the row.",
  ],
});

term({
  beat: "7/8", title: "The gate blocks a call", command: "claude  # PreToolUse hook: desk gate", lines: beats["7/8"].slice(0, 6), keys: ["exit code", "default deny"], lineMs: 120,
  captions: [
    "The same hook Claude Code calls blocked a real Bash call under a policy that permits nothing.",
    "It fails closed: with no matching permit, the answer is no.",
  ],
});

sponsors({
  title: "Where each sponsor sits",
  flow: ["agent logs", "Zetaris", "ledger + Meterless engines", "Nemotron agents", "gate + signed dossier"],
  cards: [
    { k: "Data layer", h: "Zetaris", p: "One statement over a file silo, a SQL silo and a REST silo: invoices, CI, roster.", off: "Switched off: billed spend falls from $6,123 to $0." },
    { k: "Memory and history", h: "Meterless", p: "World Model, H-MEM and Markovian engines, run in our process. Conformance 8/8, 13/13, 8/8.", off: "Switched off: \"what changed before 15 October?\" becomes unknowable." },
    { k: "Language roles", h: "NVIDIA Nemotron", p: "Drafter, Attacker, Planner, Explainer, the canary and all three benchmark arms.", off: "Switched off: a rule brain answers and the trace says so." },
    { k: "Development", h: "Cursor", p: "The required IDE. Its session log is in the repository, and nothing is claimed beyond what it records.", soft: true },
  ],
  captions: [
    "Where each sponsor sits. Zetaris is the data layer: three silos, one statement.",
    "Meterless holds memory and history. Each of its engines changes an answer when it is switched off.",
    "Nemotron runs every language role, and the same model sits behind all three benchmark arms.",
    "Cursor is the required IDE. Its log claims only what was done in it.",
  ],
});

card({
  h1: "Run it on your own logs.",
  lines: ["npm run desk", "Under three minutes. Entirely local. Your autopsy, your ranked fixes, and what it could not know.", "No logs? npm run desk -- --sample"],
  small: true,
  hold: 9,
  caption: "Everything here is in the repository: the code, the recordings, the pre-registration, and what failed.",
});

const firstScene = Date.now() - t0;
for (const s of scenes) await s();
await caption("");
const total = (Date.now() - startedAt) / 1000;
console.log("recorded", total.toFixed(0), "s");

const videoPath = await page.video().path();
await context.close();
await browser.close();
ui.kill();
spawnSync("taskkill", ["/PID", String(ui.pid), "/T", "/F"], { shell: true });
staticServer.close();

const startSec = (firstScene / 1000 + 1.2).toFixed(2);
const ff = spawnSync("ffmpeg", ["-y", "-ss", startSec, "-i", videoPath, "-t", String(Math.floor(total) - 2), "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outMp4], { stdio: "inherit" });
console.log("ffmpeg exit", ff.status, "->", outMp4);
