// Renders chosen frames of the video as PNGs so every scene can be looked at before the full render.
//   node stills.mjs <outDir> <frame> [<frame> ...]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [outDir, ...frames] = process.argv.slice(2);
if (!outDir || !frames.length) { console.error("usage: node stills.mjs <outDir> <frame> ..."); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const serveUrl = await bundle({ entryPoint: resolve(import.meta.dirname, "src/index.ts"), publicDir: resolve(import.meta.dirname, "public") });
const composition = await selectComposition({ serveUrl, id: "Demo", port: 3417, browserExecutable: chrome });
for (const f of frames) {
  const output = join(outDir, `frame-${String(f).padStart(5, "0")}.png`);
  await renderStill({ composition, serveUrl, frame: Number(f), output, port: 3417, browserExecutable: chrome });
  console.log(output);
}
