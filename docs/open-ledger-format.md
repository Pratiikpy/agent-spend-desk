# The open ledger format: `desk.events/1`

The Desk keeps what each model call looked like as rows in its own database. This is the same record as a file any other tool can read or write. A tool that can write this format can have its spend counted by the Desk without the Desk knowing anything else about it; a tool that can read it can use the Desk's record without opening the Desk's database.

The format is JSON Lines, UTF-8: one JSON object per line, a header first, then sessions, then calls. A machine-readable description is in [`docs/schema/desk-events-1.schema.json`](schema/desk-events-1.schema.json), and `desk events schema` prints it. The rules that span more than one field are in the table at the end; a JSON Schema cannot say them.

## What is in it, and what is not

It holds facts a tool observed: when a call was made, which model, how many tokens of each kind, what the tool itself said the call cost. It holds no estimate. A cost in dollars belongs to a price list, and the reader brings its own; the Desk prices the tokens against a dated price snapshot and keeps a cost the tool reported beside that estimate, never in place of it. It holds no prompt, no tool result and no model output, and has no field where one could go.

A value that is not known is left out or `null`. It is never `0`: a call whose cache writes are not reported has no cache-write count, not a count of zero.

## Records

The header is the first line:

```json
{"schema":"desk.events/1","type":"header","tool":"my-tool","tool_version":"1.4.2","produced_at":"2026-10-20T10:00:00Z"}
```

A session says what a group of calls belongs to. It is optional: a call that names a session no record describes gets one with nothing known about it.

```json
{"type":"session","session_id":"s-9","project_path":"/work/shop","git_branch":"main","tool_version":"1.4.2"}
```

A call:

```json
{"type":"call","call_id":"c-1","session_id":"s-9","ts":"2026-10-20T10:00:03.250Z","model":"claude-opus-5","input_tokens":1200,"output_tokens":340,"cache_read_tokens":800,"cache_write_5m_tokens":0,"cache_write_1h_tokens":0,"reported_cost_micros":21400,"reported_currency":"USD"}
```

| Field | Required | Meaning |
|---|---|---|
| `call_id` | yes | Unique in the file. The Desk stores it as `ev:<tool>:<call_id>`, so two tools that number their calls from 1 do not collide. Reading a file again stores nothing twice. |
| `session_id` | yes | Which session the call belongs to. |
| `ts` | yes | ISO 8601 in UTC, ending in `Z`. A time before 2015 or from 2100 on is refused as implausible. |
| `model` | yes | The model name as the tool knows it. A model the Desk has no price for is counted and left unpriced; no dollars are invented. |
| `input_tokens`, `output_tokens` | yes | Whole numbers, 0 to 10,000,000,000. `input_tokens` excludes cache reads and cache writes. |
| `reasoning_tokens` | no | Reasoning tokens that are already inside `output_tokens`. Informational; never added to it, and never more than it. |
| `cache_read_tokens` | no | Tokens read from a cache. |
| `cache_write_5m_tokens`, `cache_write_1h_tokens` | no | Cache writes by how long they are kept. Give both, or give neither and use the next field. |
| `cache_write_tokens` | no | Cache writes when the tool does not say how long they are kept. Priced as 5-minute writes and marked as assumed. Not allowed beside the two above. |
| `service_tier`, `speed`, `stop_reason` | no | As the tool reports them. |
| `is_sidechain`, `is_api_error` | no | `true`, `false` or `null`. |
| `tool_names` | no | Names of the tools the model called, at most 100, each at most 64 characters. Names only. |
| `reported_cost_micros`, `reported_currency` | no | What the tool itself said the call cost, in millionths of the currency, which is a three-letter code. Give both or neither. |

## How the Desk reads a file

The reader is strict. Every line is checked, a problem is reported with its line number and the field, and **a file with any invalid line is refused whole, and nothing from it is stored**. A ledger that quietly drops the calls it could not read understates what was spent, which is the one thing it exists to avoid.

`desk events validate <file>` checks a file without touching a ledger. `desk events import <file>` stores it. A file that claims to be from a source the Desk reads itself (`claude_code`, `codex`, `opencode`, `litellm`, `otel`, `gateway`, `statusline`, or `desk`) is refused, because importing its calls as well would count them twice.

The newest schema a reader understands is named in the header. A file written to a later schema (`desk.events/2`) is refused with a message that says so, and is not read as if it were this one.

## How the Desk writes a file

`desk events export --output file.jsonl` writes the ledger's calls in this format and reads the file back before it says it is done. Folders and branches are left out unless `--with-paths` is given, since they name projects. `--tool`, `--since` and `--until` narrow it. The export will not overwrite a file. A file holds at most 1,000,000 records; a larger ledger is exported in date ranges.

The Desk's own export names its header tool `desk`, so importing it back into the same ledger is refused rather than counted twice.

## Rules across fields

| Rule | Why |
|---|---|
| `cache_write_tokens` is not allowed with `cache_write_5m_tokens` or `cache_write_1h_tokens`. | Two answers to one question; the reader would have to pick. |
| `reasoning_tokens` is not more than `output_tokens`. | It is part of it. |
| `reported_cost_micros` needs `reported_currency`. | The Desk does not guess a currency. |
| `call_id` appears once per file, and so does each `session_id` in a session record. | A repeated id would be counted once or twice depending on the reader. |
| The header is the first record, and there is one. | The tool's name is what the ids are filed under. |
| A line is at most 65,536 bytes. | A hostile file cannot make a reader hold a line of any size. |
