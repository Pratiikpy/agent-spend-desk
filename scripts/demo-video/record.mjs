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
const benchOut = existsSync(join(repo, "docs/verification/benchmark/results.jsonl")) ? run(["bench", "report", "--sample"]).replace(/\n+$/, "").split("\n") : null;

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
const term = (spec) => scenes.push(() => player("play", spec));
const card = (spec) => scenes.push(() => player("titleCard", spec));

card({ h1: "Every dollar your agents spend, tied to work that landed.", lines: ["desk. is a local desk for the person who pays for AI coding agents: it explains the limit, checks the agent daily, tests a spend policy on a month it never saw, and signs what it concludes.", "Organisational data through Zetaris. History, memory and long-range engines from Meterless. Language roles on NVIDIA Nemotron. Built in Cursor and Claude Code.", "Open Agent Hackathon 2026 · Track 3, Reasoning Architecture"], small: true, hold: 8, caption: "Constructed scenario. Every figure on screen is computed from it by the same code that reads your logs." });

term({ beat: "1/8", title: "Where did my limit go?", command: "npm run desk -- --sample", lines: beats["1/8"].slice(1), keys: ["Sub-agents", "could not know"], lineMs: 55, hold: 17, captions: [{ t: 0, text: "Two hours in, the limit appears and I do not know why." }, { t: 6, text: "The card splits one heavy window by cause. Sub-agents are 59% of it." }, { t: 12, text: "It ranks the fixes, and says what it could not know." }] });

term({ beat: "2/8", title: "The bill, through Zetaris", command: "npm run desk -- silos --sample", lines: beats["2/8"].filter((l) => !l.startsWith("  {") && l.trim() !== "trace"), keys: ["Bill classes", "CI facts"], lineMs: 90, hold: 17, captions: [{ t: 0, text: "The bill is not in the logs: invoices in a bucket, CI in Postgres, a roster behind a service." }, { t: 6, text: "One Zetaris statement joins the three. Invoices sit 1.2% under my list-price estimate." }, { t: 12, text: "And 60 landed sessions merged although the checks were red." }] });

scenes.push(async () => {
  await uiScene("/canary", [
    { t: 0, text: "The canary: one real run of a 52-task pack, a day, on each arm. Constructed: the primary arm's model was switched on day 15." },
    { t: 14, text: "The call comes with its interval, a flat control arm, and what it cannot say." },
  ], 30, async (tick) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 9000) { await tick(); await sleep(250); }
    await page.evaluate(() => window.scrollTo({ top: 640, behavior: "smooth" }));
  });
});

term({ beat: "3/8", title: "The canary verdict", command: "npm run desk -- canary --sample", lines: canaryText, keys: ["Regressed", "regressed", "control arm", "consistent with"], lineMs: 80, hold: 13, captions: [{ t: 0, text: "The statistic calls a regression only when every condition holds in two consecutive windows." }, { t: 7, text: "Consistent with a switch of the served model; never claimed as the cause." }] });

term({ beat: "4/8", title: "Propose, check, attack, then replay", command: "npm run desk -- propose --sample --dossier", lines: beats["4/8"], keys: ["HELD OUT", "narrows only", "attacker", "drafter"], lineMs: 75, hold: 19, captions: [{ t: 0, text: "Nemotron drafts rules from September. Code checks they only narrow the policy, over every cell." }, { t: 9, text: "The Attacker looks for requests that step around them." }, { t: 17, text: "Then the policy meets October, a month it never saw. Landed work it would block is the headline." }] });

scenes.push(async () => {
  await uiScene("/ask", [{ t: 0, text: "I ask a question. The Planner proposes a typed program, code runs it read-only, the Auditor checks every figure." }, { t: 18, text: "Switch the History engine off, ask again: the answer changes. That is the proof it does something." }], 42, async (tick) => {
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
    await page.keyboard.press("Enter");
    await page.locator("input[type=text], input:not([type])").first().press("Enter");
    await sleep(5000);
    await toAnswer();
    await sleep(3000);
    await tick();
  });
});

if (benchOut) term({ beat: "5/8", title: "Same model, three ways", command: "npm run desk -- bench report --sample", lines: benchOut, keys: ["exact \\(all", "correct abstention", "held-out"], lineMs: 70, hold: 20, captions: [{ t: 0, text: "60 pre-registered questions, computed answers, the same Nemotron model in three arms." }, { t: 9, text: "A single call, a tool-using agent, and the Desk's architecture. Every metric is published, including where the Desk loses." }, { t: 17, text: "Level with the tool agent, not better: four questions in sixty is noise." }] });

term({ beat: "6/8", title: "Approve, then verify offline", command: "npm run desk -- approve <request> <digest>", lines: beats["6/8"], keys: ["RESULT", "row_hash_mismatch"], lineMs: 70, hold: 15, captions: [{ t: 0, text: "To apply it I echo the action digest. A signed dossier is written." }, { t: 8, text: "Anyone can verify it on plain Node with the network off. Change one byte and the verifier names the row." }] });

term({ beat: "7/8", title: "The gate blocks a call", command: "claude  # PreToolUse hook: desk gate", lines: beats["7/8"].slice(0, 6), keys: ["exit code", "default deny"], lineMs: 120, hold: 12, captions: [{ t: 0, text: "The same hook Claude Code calls blocked a real Bash call under a policy that permits nothing." }, { t: 6, text: "If the gate is down, it blocks. Recorded runs against the real Claude Code are in docs/verification." }] });

card({ h1: "Run it on your own logs.", lines: ["npm run desk", "Under three minutes. Entirely local. Your autopsy, your ranked fixes, and what it could not know.", "No logs? npm run desk -- --sample"], small: true, hold: 9, caption: "A new regression cannot be called before day 28, and the card says so." });

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
