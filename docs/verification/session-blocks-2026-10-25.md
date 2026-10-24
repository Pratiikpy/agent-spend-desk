# Waste blocks and their explanation (2026-10-25)

A session now lists its waste blocks, and each opens an explanation: `#/sessions?id=<session>&block=<block>`, from `/api/session/block`.

## What a block is

A run of calls that one rule flags together, found in each thread of the session separately:

- **C-LOOP-1**, a failing command repeated: from the third identical failing tool use inside twelve calls, with no prompt from you in between (the rule's own settings, `CONFIG`);
- **C-IDLE-1**, the agent working on its own: calls with no prompt and no tool result to answer, more than thirty minutes after your last prompt;
- **C-FANOUT-1**, a delegated agent's run: not necessarily waste, it is the cost a cap on delegated agents governs, and the explanation says so;
- **C-CACHE-1**, one call that rewrote a context the cache held: the pause was longer than the cache's life, the model changed, or the shape of the tokens says so and nothing else does.

## What the explanation shows

Opening at the stop point: where the rule would have acted and what stopping there would have saved (the cost of that call and every later call of the block, at each call's own price snapshot; an upper bound that assumes nothing later was needed); the matched rule with its settings and what was observed; the **failure cascade** from the first break (the earliest call with the failing tool use the loop repeats) to the end of the block, with its confidence; the redacted lines from the agent's own log; each call's price snapshot; and what git shows the session landed before, during and after the block.

- **Confidence.** A chain is marked low when an opaque step lies between the first break and the stop point: a delegated agent's call, or a tool use with no result in the log. A cache miss read from timestamps or a model name is high; one with no such explanation is low and says the logs do not say what changed. A gap after the stop point does not weaken the chain that led to it.
- **Log lines.** The ledger keeps no message text, so the lines are read from the log file again when someone asks, on this machine. Each excerpt is masked for credentials, paths and long random strings and cut to 240 characters. A file that has moved or a call or result that is not in it is shown as a gap, never filled in; the response never names the file.
- **Landing.** "No commit is tied to this session" is said to be unknowable, not proof that nothing landed. A commit made after the block ends is said to mean the session went on to land work, so stopping it may have cost that.
- Unpriced calls in a block are counted apart and not priced.

## What was run

- `tests/desk/explain-blocks.test.ts` (10): the loop block starting at the third failure with the chain from the first; three ordinary repeated reads, three different failures, a fourth after a prompt and two failures are not loops; the chain going low-confidence for a delegated call and for a tool use with no result, not for a gap after the stop; blocks kept apart and ordered by cost; idle with its numbers and its negatives (a tool result waiting, a recent prompt); cache misses read as pause, model switch or unexplained; fan-out per delegated thread; unpriced calls not priced.
- `tests/desk/ui/session-block.test.ts` (8): a real Claude Code style log with a loop, ingested, served, and explained end to end: the lines read from the log file with a credential shape masked and a path in a command shortened or masked, no file path in the response, a missing file shown as a gap, a call or result not in the file listed as missing, long lines cut, the landing statement for a session with no commit, and refusals for an unknown session or block or an oversized id.
- The block page was photographed on the constructed sample in light at desktop width (the whole page, console clean) and the session's block list at phone width in dark.

## Not covered

- Real Claude Code logs from this machine were not opened in the block view: the explanation was run on the constructed sample and on a log written in the same line structure. Real logs may carry shapes the excerpt reader does not know (it reads tool uses, assistant text and tool results).
- The stop point is a counterfactual on a recorded session, as is every saving shown: no stop was ever tried on a live agent here.
- A session with more than 3,000 calls draws only the first 3,000 on its timeline; the block list uses all calls.
- A long session lists at most the 50 costliest blocks.
- The timeline chart on the session page does not mark the stop point; the block page does, in its call table.
