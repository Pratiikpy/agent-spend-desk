# <Project name>

> We are building an agent that helps **[user]** solve **[problem]** by **[capability]** using **[data]**, producing **[output]**.

Open Agent Hackathon 2026 · Track: <track>

## What it does

Two short paragraphs. What goes in, what comes out, who uses it. One screenshot of real output.

## How it works

Diagram of the agents and the critique loop. One paragraph per agent. Link to `docs/design/agent-loop-spec.md`.

## Quick start

Everything needed to run it from a clean clone. No steps outside this list.

```bash
git clone <repo>
cd <repo>
cp .env.example .env          # then fill in the values listed below
<install command>
SAMPLE_MODE=true <run command> # runs with no credentials, using the bundled sample
<run command>                  # live mode
```

Expected run time: <minutes>. Expected output: `output_examples/<file>`.

## Configuration

| Variable | Purpose | Required |
|---|---|---|
| `SAMPLE_MODE` | use bundled sample data and skip live services | no |
| | | |

## Sponsor technology

| Sponsor | Role in this project | Where |
|---|---|---|
| Zetaris | | `src/...` |
| Meterless | | `src/...` |
| Cursor | development environment | `docs/sponsors/cursor-usage-log.md` |
| NVIDIA | | |

## Data

Summary and pointer to `data/README.md`.

## Reliability

Timeouts, retry caps, fallbacks, and what happens when each external service is unavailable.

## Logs and traces

Where run logs are written, their format, and a sample at `output_examples/traces/`.

## Limitations

Plain statement of what it does not do and where it can be wrong.

## Dependencies and licences

## Tests

How to run them; what they cover.
