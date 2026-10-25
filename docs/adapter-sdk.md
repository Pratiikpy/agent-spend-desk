# The adapter SDK

An adapter teaches the Desk to read one more tool's files. The Desk reads Claude Code, Codex, OpenCode, LiteLLM spend logs and OpenTelemetry spans itself; for any other tool, an adapter turns the tool's own file into [`desk.events/1`](open-ledger-format.md), which the Desk imports. Or the tool can write that format directly and needs no adapter.

## An adapter is a folder

```
my-tool/
  adapter.json                the manifest
  adapter.mjs                 the code: detect and parse
  fixtures/
    sample.log                a real file from the tool: the one the adapter was built from
    sample.log.golden.jsonl   what parse must produce from it, line for line
```

`desk adapters init my-tool --id my-tool --tool "My Tool" --from path/to/a-real-file --origin "My Tool 2.1, captured 2026-10-22 from a real session"` makes the folder, pins the sample's hash in the manifest and writes a stub `adapter.mjs`.

### The manifest

```json
{
  "id": "my-tool",
  "tool": "My Tool",
  "version": "0.1.0",
  "description": "Reads My Tool's usage log.",
  "license": "MIT",
  "schema": "desk.events/1",
  "entry": "adapter.mjs",
  "sample": { "file": "fixtures/sample.log", "sha256": "...", "kind": "real", "origin": "My Tool 2.1, captured 2026-10-22 from a real session", "capturedAt": "2026-10-22" },
  "fixtures": [ { "input": "fixtures/sample.log", "golden": "fixtures/sample.log.golden.jsonl" } ]
}
```

`sample.kind` is `real` for a file from a real run of the tool, or `constructed` for one made up to show how an adapter is written. A constructed adapter passes its tests and **will not import**: an adapter exists only when it was built from a real sample. The Desk cannot check that a file is real; `origin` is the author's statement, and the hash pins which file it is.

### The code

```js
export default {
  // True when the first bytes of a file (up to 8 KB) are this tool's. It must say false for anything else.
  detect(head) { ... },
  // Turn a whole file into { sessions, calls, notes }. Pure and deterministic.
  parse(text, { fileName }) { ... },
};
```

`parse` returns session and call records as in the format (without `type`), and `notes`: a line for everything it skipped. **An adapter never skips quietly.** The Desk writes the header itself, with the adapter's `id` as the tool, so an adapter cannot claim to be another tool, and checks every record against the format. A call the adapter cannot fill in a required field for is a note and a skipped line, not a guess.

`adapters/example-usage-jsonl/` is a complete worked example with a made-up tool, two fixtures, and a truncated last line handled by a note.

## What the Desk does before it loads an adapter

`desk adapters test my-tool` (and `desk adapters list`) checks all of this. An adapter that fails any of it is not loaded:

1. The manifest is valid, and every path in it stays inside the adapter's folder.
2. The sample file exists and is the file whose SHA-256 the manifest pins.
3. At least one fixture runs on the sample.
4. For every fixture, `parse` produces the golden file byte for byte, and gives the same bytes on a second run.
5. The output is valid `desk.events/1`.
6. `detect` says true for the sample and false for an empty file, for a JSON object that is not the tool's, and for a `desk.events/1` file. An adapter that claims files that are not its tool's would capture other tools' files.

`desk adapters test my-tool --write-golden` writes the golden file for a fixture that has none, from the adapter's own output. **Read it against the sample before relying on it**: a golden made by the adapter proves nothing until a person has checked it. It never overwrites one that exists.

`desk adapters import my-tool file...` runs the adapter over the owner's files, prints the adapter's notes, and imports the events. Ids are filed under the adapter's `id`, so reading the same file again stores nothing twice.

## The sandbox

An adapter is code someone else wrote, run on the owner's machine. It runs in a process of its own, started with Node's permission model on:

- it can read its own folder and nothing else, and write nowhere;
- it cannot start a process, a worker or native code;
- it may import only `crypto`, `path`, `url`, `util`, `buffer`, `string_decoder`, `zlib`, `assert`, `events`, `stream`, `querystring`, `timers`, `fs` and `process`, and no package;
- `fetch`, `WebSocket` and `EventSource` are removed;
- it gets 30 seconds, 512 MB of heap, an empty environment, and a file of at most 64 MB;
- nothing leaves it but the JSON it returns.

If this Node cannot start with the permission model on, **no adapter is run**: the sandbox is not optional.

What this does not promise: it stops a careless adapter from doing damage and a curious one from reading files, and it was tested against reads and writes outside the folder, network and process modules, `process.binding`, native addons, a loop that never ends, and an adapter that throws. It is not a proof that a hostile adapter cannot get out; Node's permission model is the main thing it rests on, and it has not been audited here. **Read an adapter before you run it, as you would any package.** The fixtures prove an adapter reads its sample correctly; they say nothing about whether it is safe.
