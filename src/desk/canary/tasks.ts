import { createHash } from "node:crypto";

/**
 * The canary task pack: small tasks with one right answer that code can check (spec 8.5, deterministic checks
 * first). Each is a task a person could set an agent: arithmetic on money, ordering and dates, reading a log or a
 * record, reading code. Nothing here is executed from a model's output: answers are text, and a checker reads
 * text. The tasks are written for this pack; they are not taken from a benchmark, so a model has not been trained
 * on them as such.
 */
export interface CanaryTask {
  id: string;
  /** Tasks in a cluster share a kind of skill; a shock hits a cluster, so the statistic treats a cluster as one. */
  cluster: "money" | "logic" | "records" | "code";
  prompt: string;
  /** Returns 1 for a right answer, 0 for a wrong one. Never throws. */
  check(answer: string): 0 | 1;
}

const ANSWER_ONLY = "Reply with only the final answer, no explanation.";

/** Every number in a text, in order, with thousands separators removed. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** The answer is the last number the reply states: models that show a line of working still end on the result. */
const lastNumberIs = (want: number, tolerance = 0.005) => (answer: string): 0 | 1 => {
  const nums = numbersIn(answer);
  const got = nums[nums.length - 1];
  return got !== undefined && Math.abs(got - want) <= tolerance ? 1 : 0;
};

const wordIs = (want: string) => (answer: string): 0 | 1 => {
  const t = answer.trim().toLowerCase();
  const last = t.split(/\s+/).pop()?.replace(/[^a-z]/g, "") ?? "";
  return last === want.toLowerCase() || t.replace(/[^a-z]/g, "") === want.toLowerCase() ? 1 : 0;
};

const listIs = (want: string[]) => (answer: string): 0 | 1 => {
  const got = answer.toLowerCase().match(/[a-z]+/g) ?? [];
  const tail = got.slice(-want.length);
  return tail.length === want.length && tail.every((w, i) => w === want[i]!.toLowerCase()) ? 1 : 0;
};

const dateIs = (want: string) => (answer: string): 0 | 1 => {
  const found = answer.match(/\d{4}-\d{2}-\d{2}/g);
  return found !== null && found[found.length - 1] === want ? 1 : 0;
};

const LOG = [
  "09:58:11 INFO  worker-3 started",
  "10:02:41 ERROR worker-1 timeout talking to billing",
  "10:07:09 INFO  worker-2 job 4411 done",
  "10:15:30 ERROR worker-3 disk full on /var/data",
  "10:31:02 WARN  worker-1 retrying job 4412",
  "10:44:55 ERROR worker-2 bad checksum job 4413",
  "10:59:59 ERROR worker-1 timeout talking to billing",
  "11:00:00 ERROR worker-2 queue stalled",
  "11:12:48 INFO  worker-3 job 4414 done",
  "09:30:12 ERROR worker-1 cold start failed",
].join("\n");

const USERS = JSON.stringify([
  { name: "Wren", age: 34 },
  { name: "Odo", age: 29 },
  { name: "Mara", age: 41 },
  { name: "Ines", age: 30 },
  { name: "Zed", age: 52 },
  { name: "Cato", age: 31 },
]);


export const TASKS: readonly CanaryTask[] = [
  { id: "money-change", cluster: "money", prompt: `A shop sells pens at 1.35 dollars each. Maria buys 17 pens and pays with a 50 dollar bill. How many dollars of change does she get? ${ANSWER_ONLY}`, check: lastNumberIs(27.05) },
  { id: "money-compound", cluster: "money", prompt: `2,000 dollars is invested at 5 percent annual interest, compounded once a year, for 3 years. What is the balance in dollars, rounded to the nearest cent? ${ANSWER_ONLY}`, check: lastNumberIs(2315.25) },
  { id: "money-percent", cluster: "money", prompt: `What is 15 percent of 640? ${ANSWER_ONLY}`, check: lastNumberIs(96) },
  { id: "money-invoice", cluster: "money", prompt: `Add up this invoice. Each line is quantity x item @ unit price; the last line is a flat charge. What is the total in dollars?
4 x notebook @ 12.50
3 x pen box @ 8.00
Shipping 5.00
${ANSWER_ONLY}`, check: lastNumberIs(79) },
  { id: "logic-order", cluster: "logic", prompt: `Ann is taller than Bo. Bo is taller than Cy. Dee is shorter than Cy but taller than Eli. Who is the third tallest of the five? ${ANSWER_ONLY}`, check: wordIs("Cy") },
  { id: "logic-weekday", cluster: "logic", prompt: `Today is Wednesday. What day of the week will it be in 10 days? ${ANSWER_ONLY}`, check: wordIs("Saturday") },
  { id: "logic-sheep", cluster: "logic", prompt: `A farmer has 17 sheep. All but 9 of them run away. How many sheep does the farmer have left? ${ANSWER_ONLY}`, check: lastNumberIs(9) },
  { id: "logic-sequence", cluster: "logic", prompt: `What number comes next in this sequence: 3, 8, 15, 24, 35, ? ${ANSWER_ONLY}`, check: lastNumberIs(48) },
  { id: "records-errors", cluster: "records", prompt: `How many lines in this log are ERROR lines with a timestamp from 10:00:00 to 10:59:59 inclusive? The lines are not in order.\n${LOG}\n${ANSWER_ONLY}`, check: lastNumberIs(4) },
  { id: "records-users", cluster: "records", prompt: `From this JSON list of users, give the names of everyone strictly older than 30, sorted alphabetically, separated by commas.\n${USERS}\n${ANSWER_ONLY}`, check: listIs(["cato", "mara", "wren", "zed"]) },
  { id: "records-date", cluster: "records", prompt: `What date is 30 days after 2026-02-10? Answer as YYYY-MM-DD. ${ANSWER_ONLY}`, check: dateIs("2026-03-12") },
  { id: "records-leap", cluster: "records", prompt: `How many days are there from 2027-12-20 to 2028-03-05, counting the start day but not the end day? ${ANSWER_ONLY}`, check: lastNumberIs(76) },
  { id: "code-sum", cluster: "code", prompt: `What does f(9) return?\ndef f(n):\n    return sum(i * i for i in range(1, n + 1) if i % 2 == 1)\n${ANSWER_ONLY}`, check: lastNumberIs(165) },
  { id: "code-chain", cluster: "code", prompt: `What does this JavaScript expression evaluate to?\n[3, 1, 4, 1, 5, 9, 2, 6].filter(x => x > 2).map(x => x * 2).reduce((a, b) => a + b, 0)\n${ANSWER_ONLY}`, check: lastNumberIs(54) },
  { id: "code-alias", cluster: "code", prompt: `What does this Python program print?
x = [1, 2, 3]
y = x
y.append(4)
print(len(x))
${ANSWER_ONLY}`, check: lastNumberIs(4) },
  { id: "code-count", cluster: "code", prompt: `How many times does the letter a appear in the text "banana bandana"? ${ANSWER_ONLY}`, check: lastNumberIs(6) },
];

/** What a run is measured against. It changes when a task, its prompt or its checker changes, and a changed harness is reported as one. */
export function harnessHash(): string {
  const material = TASKS.map((t) => `${t.id}\n${t.cluster}\n${t.prompt}\n${t.check.toString()}`).join("\n---\n");
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

/** Score one reply. A missing or empty reply is an error (no score), never a zero. */
export function scoreReply(task: CanaryTask, reply: string | null): 0 | 1 | null {
  if (reply === null || reply.trim() === "") return null;
  try {
    return task.check(reply);
  } catch {
    return null;
  }
}
