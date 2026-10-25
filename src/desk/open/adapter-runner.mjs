// Runs one adapter in a process of its own (DF-063). The parent starts this file with Node's permission model on, so the process can read the adapter's folder and this
// file and nothing else, and can write nowhere, start no other process and load no native code. This file adds the two things the permission model does not cover:
// the adapter may import only a short list of built-in modules (no network, no child processes, no workers), and the global fetch is removed.
//
// It reads one JSON request on standard input: { entry, op, text, fileName }. It writes one JSON reply on standard output: { ok: true, out } or { ok: false, error }.
// That is the only way anything leaves. An adapter that is hostile is not made safe by this; see docs/adapter-sdk.md for what is and is not promised.
import { isBuiltin, registerHooks } from "node:module";
import { readFileSync } from "node:fs";

const ALLOWED = new Set(["crypto", "path", "url", "util", "buffer", "string_decoder", "zlib", "assert", "events", "stream", "querystring", "timers", "fs", "process"]);
const LOCATION = /^(?:file|data):/;

registerHooks({
  resolve(specifier, context, next) {
    // A path or a URL goes on (the permission model decides what it may read). Anything else is a built-in module or a package name: only the short list passes.
    if (specifier.startsWith(".") || specifier.startsWith("/") || LOCATION.test(specifier)) return next(specifier, context);
    const name = specifier.replace(/^node:/, "").split("/")[0];
    if (!isBuiltin(specifier) || !ALLOWED.has(name)) throw new Error(`the adapter may not import "${specifier}"`);
    return next(specifier, context);
  },
});
for (const name of ["fetch", "WebSocket", "EventSource"]) {
  try {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
  } catch {
    // not defined in this runtime
  }
}

function reply(o) {
  process.stdout.write(JSON.stringify(o));
}

try {
  const req = JSON.parse(readFileSync(0, "utf8"));
  const mod = await import(req.entry);
  const adapter = mod.default;
  if (adapter === null || typeof adapter !== "object") throw new Error("the adapter module must export an object as its default export");
  if (req.op === "detect") {
    if (typeof adapter.detect !== "function") throw new Error("the adapter has no detect function");
    reply({ ok: true, out: adapter.detect(req.text) === true });
  } else if (req.op === "parse") {
    if (typeof adapter.parse !== "function") throw new Error("the adapter has no parse function");
    const out = await adapter.parse(req.text, { fileName: req.fileName });
    reply({ ok: true, out });
  } else {
    throw new Error(`unknown op ${String(req.op)}`);
  }
} catch (e) {
  reply({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 2000) });
}
