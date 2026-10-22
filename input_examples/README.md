# Input examples

`claude-code-session-example.jsonl` is one session from the constructed sample, in the exact format Claude Code writes under `~/.claude/projects/<folder>/<session>.jsonl`, with the working directory replaced. It is synthetic: no real person, project or code.

To read it as your own logs would be read:

```
mkdir -p /tmp/desk-example/projects/example && cp input_examples/claude-code-session-example.jsonl /tmp/desk-example/projects/example/
npm run desk -- card --claude-dir /tmp/desk-example/projects --db /tmp/desk-example/ledger.db
```

The whole constructed sample is generated, not stored: `npm run desk -- sample build --out data/desk/sample` writes about 2,000 log files and five git repositories from a seed, together with `truth.json`, the record of what was planted in them.
