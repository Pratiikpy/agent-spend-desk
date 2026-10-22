# Ledger check against ccusage (2026-10-22)

Purpose: confirm the Desk's Claude Code log reader and cost formula agree with an independent tool before anything is built on them.

Method: ingest the whole local Claude Code log tree (4,272 files) into the ledger, run `ccusage daily --json` over 15 to 22 October on the same machine, and compare day by day (local time, UTC+5:30) and model by model.

Result:
- For every Claude model on the days compared, input, output, cache-read and cache-write token counts are identical, and cost agrees to within one cent per model-day (both use LiteLLM list prices).
- ccusage also totals other agents' logs (Gemini and OpenAI models) that the Desk does not read yet. That, and only that, explains the remaining gap in its day totals.
- Cache-write tokens matched exactly on all days, including the split between 5-minute and 1-hour writes.

Defects the comparison found and fixed (each now has a test):
1. Log discovery stopped at a fixed depth and missed 1,673 nested workflow subagent logs. It now walks the whole tree without following links.
2. A call is written as several lines with the same message id. Input and cache counts are identical across them, but the output count grows while the call streams (for example 5, then 143). The ledger keeps the final value and counts a real conflict only when input or cache counts change.

Not verified here: costs are list-price estimates, not invoices; plan discounts, batch rates and long-context tiers are not applied. Only the Claude Code log format has been read. The check covers one machine and one tool version.
