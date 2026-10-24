/**
 * What `desk help` prints: the commands, grouped by what a person is trying to do, with one plain line each. A test
 * compares this list with the commands the CLI actually dispatches on, so a command cannot be added without being listed.
 */
export interface CommandHelp {
  name: string;
  group: "Start here" | "Read more sources" | "Costs and limits" | "Decide and enforce" | "Ask and remember" | "Privacy" | "Evidence";
  summary: string;
}

export const COMMANDS: readonly CommandHelp[] = [
  { name: "card", group: "Start here", summary: "Read your Claude Code logs and print the card: where the money went, and one change worth trying. This is what plain `desk` does." },
  { name: "ui", group: "Start here", summary: "Start the screens (Brief, Bill, Autopsy, Sessions, Outcomes, Policy, Canary, Ask and more) and print the address to open in a browser." },
  { name: "status", group: "Start here", summary: "How many of the specified features are built, counted from the code (`status write` writes the page)." },

  { name: "ingest", group: "Read more sources", summary: "Read agent logs into the ledger: Claude Code by default, or --agent codex, opencode or statusline." },
  { name: "retention", group: "Read more sources", summary: "Which agent logs are about to be deleted before they were read, and a daily ingest command (`retention schedule`)." },
  { name: "statusline", group: "Read more sources", summary: "The Claude Code status line that records your plan limits (`statusline install` prints the setting to add)." },
  { name: "task", group: "Read more sources", summary: "Label the work you start (`task <label>`, `task end`) so sessions group into tasks; `task list` shows how each task was identified." },
  { name: "invoices", group: "Read more sources", summary: "Import an invoice or usage export (CSV, or PDF read twice) and reconcile billed against estimated against reported, month by month." },
  { name: "questions", group: "Read more sources", summary: "Where the Desk is unsure which session a commit came from, it asks; your yes or no is applied the next time landing is computed." },
  { name: "landing", group: "Read more sources", summary: "Tie sessions to the commits they produced in your repositories, and show what the spend bought." },
  { name: "reconcile", group: "Read more sources", summary: "Compare the cost Claude Code recorded for itself with our estimate, process by process." },
  { name: "silos", group: "Read more sources", summary: "Ask the invoice, CI and roster data through Zetaris (`silos seed` builds the sample data)." },

  { name: "gauge", group: "Costs and limits", summary: "What the last few hours cost, how fast, where it went and where your plan windows stand; --line for a status line, --watch to keep it fresh." },
  { name: "estimate", group: "Costs and limits", summary: "Before a large task: the cost range of similar past tasks and how many there were, or no estimate when fewer than ten are similar." },
  { name: "approvals", group: "Costs and limits", summary: "What is waiting for your approval, how fast and how carefully past ones were decided; `show <id>` opens the evidence, `deny <id>` says no." },
  { name: "close", group: "Costs and limits", summary: "Close a month: spend, invoices, canary, a replay and drafted change, and a signed month dossier a stranger can check offline." },
  { name: "review", group: "Costs and limits", summary: "The weekly review: what the week cost, what it bought, how the forecasts did, what drifted, and at most three changes worth making." },
  { name: "bill", group: "Costs and limits", summary: "The bill for a month or any dates: kinds of figure, what it bought, where it went; --export csv or json gives every line." },
  { name: "autopsy", group: "Costs and limits", summary: "Split a window of spend into causes: idle, loops, cache misses, and work that was needed." },
  { name: "limits", group: "Costs and limits", summary: "What a percent of your plan limit costs in tokens, per plan and window, with an interval, or why there is no estimate." },
  { name: "runway", group: "Costs and limits", summary: "Will this plan window last until it resets? Judged from how past windows of the same plan ended." },
  { name: "prices", group: "Costs and limits", summary: "`prices compare` checks our price book against another; `reprice` prices the ledger again, keeping old costs; `history` shows them." },
  { name: "pr", group: "Costs and limits", summary: "What the agent work behind one change cost, as a description to paste into the pull request." },

  { name: "propose", group: "Decide and enforce", summary: "Draft a spend policy from your own history and check by proof that it only narrows what is in force." },
  { name: "replay", group: "Decide and enforce", summary: "Replay a policy over past sessions: what it would have blocked, and what that would have saved." },
  { name: "tunnel", group: "Decide and enforce", summary: "The same as replay, for several policies side by side." },
  { name: "alerts", group: "Decide and enforce", summary: "Tell you once when something needs you: a cap nearly spent, a pause, idle spend, a canary regression, a month that will not reconcile." },
  { name: "approve", group: "Decide and enforce", summary: "Approve a pending policy change; the approval is signed into the dossier." },
  { name: "gate", group: "Decide and enforce", summary: "The spend gate: `gate serve`, `gate gateway` (a door for tools with no hook), `gate mcp`, `gate status`, `gate open` and `gate close`." },
  { name: "seats", group: "Decide and enforce", summary: "For each person, whether a flat seat or tokens at list price is cheaper." },
  { name: "route", group: "Decide and enforce", summary: "Test a cheaper model on recorded tasks and say whether it holds up." },
  { name: "canary", group: "Decide and enforce", summary: "The daily regression check: did the agent get worse? `canary run` records today's tasks; `--if-due` is the hourly job, `schedule` prints it." },

  { name: "ask", group: "Ask and remember", summary: "Ask a question about your spend; the answer cites the rows it used and is checked before it is shown." },
  { name: "remember", group: "Ask and remember", summary: "Store a note for Ask to use later, such as an exception someone granted." },
  { name: "verify-answer", group: "Ask and remember", summary: "Check an answer's claims against the ledger." },
  { name: "lessons", group: "Ask and remember", summary: "Learn rules from past mistakes, and show whether they would have helped on held-out questions." },
  { name: "regret", group: "Ask and remember", summary: "Score earlier proposals against what happened afterwards." },
  { name: "calibrate", group: "Ask and remember", summary: "How well the confidence of a session-to-commit link and the simulator match answers we know." },

  { name: "egress", group: "Privacy", summary: "What was sent to a model: host, size and a count of masked secrets for every request, never the text." },
  { name: "forget", group: "Privacy", summary: "Delete sessions by --project, by --before a date, or --all, and say what was removed; without --yes it only shows what would go." },

  { name: "prove", group: "Evidence", summary: "Run every check against the code and print PASS, FAIL or NOT RUN with the reason." },
  { name: "bench", group: "Evidence", summary: "The recorded benchmark: Ask against plain baselines on questions with known answers." },
  { name: "demo", group: "Evidence", summary: "The scripted demonstration run, from recordings, with no network." },
  { name: "sample", group: "Evidence", summary: "`sample build` generates the 14-engineer sample that `--sample` reads; nothing of yours is read." },
  { name: "lab", group: "Evidence", summary: "Audit tasks, run an agent on them, and report the pass rates and whether the experiment is worth running (`lab audit`, `lab run`, `lab report`)." },
];

export const commandNames = (): string[] => [...COMMANDS.map((c) => c.name), "help"];

export function helpText(): string {
  const groups = [...new Set(COMMANDS.map((c) => c.group))];
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  const lines = ["desk. A local desk for the person who pays for AI coding agents: what the agents cost, what the money bought, and a policy you can check.", ""];
  for (const g of groups) {
    lines.push(g);
    for (const c of COMMANDS.filter((x) => x.group === g)) lines.push(`  ${c.name.padEnd(width)}${c.summary}`);
    lines.push("");
  }
  lines.push("Add --sample to most commands to run on a generated sample instead of your own logs. `desk help` prints this.", "More is written in README.md and docs/product-description.md.");
  return lines.join("\n");
}
