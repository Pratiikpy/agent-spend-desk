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
  cluster: "money" | "logic" | "records" | "code" | "units" | "calendar" | "text" | "tables" | "probability" | "sql" | "formats" | "algorithms" | "reading";
  prompt: string;
  /** Returns 1 for a right answer, 0 for a wrong one. Never throws. */
  check(answer: string): 0 | 1;
}

const ANSWER_ONLY = "Reply with only the final answer, no explanation.";

/**
 * A checker states what it is, so the harness can be named without reading its source text. The source text of a function changes
 * with the compiler that built it (this Desk runs through tsx, its tests through another), so a name taken from it would call every
 * stored baseline a changed harness the day a compiler was updated. A checker's name is its kind, a version that is raised whenever
 * the logic of that kind changes, and its arguments. A test scores a fixed table of answers with every kind, so changing the logic
 * without raising the version fails the build.
 */
export interface CheckSpec {
  kind: string;
  version: number;
  args: unknown[];
}
type Checker = ((answer: string) => 0 | 1) & { spec?: CheckSpec };
const tag = (fn: (answer: string) => 0 | 1, kind: string, version: number, args: unknown[]): Checker => Object.assign(fn, { spec: { kind, version, args } });

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
export const lastNumberIs = (want: number, tolerance = 0.005): Checker =>
  tag(
    (answer) => {
      const nums = numbersIn(answer);
      const got = nums[nums.length - 1];
      return got !== undefined && Math.abs(got - want) <= tolerance ? 1 : 0;
    },
    "lastNumberIs",
    1,
    [want, tolerance],
  );

export const wordIs = (want: string): Checker =>
  tag(
    (answer) => {
      const t = answer.trim().toLowerCase();
      const last = t.split(/\s+/).pop()?.replace(/[^a-z]/g, "") ?? "";
      return last === want.toLowerCase() || t.replace(/[^a-z]/g, "") === want.toLowerCase() ? 1 : 0;
    },
    "wordIs",
    1,
    [want],
  );

export const listIs = (want: string[]): Checker =>
  tag(
    (answer) => {
      const got = answer.toLowerCase().match(/[a-z]+/g) ?? [];
      const tail = got.slice(-want.length);
      return tail.length === want.length && tail.every((w, i) => w === want[i]!.toLowerCase()) ? 1 : 0;
    },
    "listIs",
    1,
    [want],
  );

export const dateIs = (want: string): Checker =>
  tag(
    (answer) => {
      const found = answer.match(/\d{4}-\d{2}-\d{2}/g);
      return found !== null && found[found.length - 1] === want ? 1 : 0;
    },
    "dateIs",
    1,
    [want],
  );

export const timeIs = (want: string): Checker =>
  tag(
    (answer) => {
      const found = answer.match(/(?<!\d)\d{1,2}:\d{2}(?!\d)/g);
      const last = found?.[found.length - 1];
      return last !== undefined && last.padStart(5, "0") === want ? 1 : 0;
    },
    "timeIs",
    1,
    [want],
  );

/** The reply ends on these numbers, in order: a short list read off the tail of the answer. */
export const numbersTailAre = (want: number[]): Checker =>
  tag(
    (answer) => {
      const got = numbersIn(answer).slice(-want.length);
      return got.length === want.length && got.every((n, i) => n === want[i]) ? 1 : 0;
    },
    "numbersTailAre",
    1,
    [want],
  );

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
  { id: "money-discount", cluster: "money", prompt: `A jacket costs 80 dollars. It is discounted by 25 percent, and then a 10 percent tax is added to the discounted price. What is the final price in dollars? ${ANSWER_ONLY}`, check: lastNumberIs(66) },
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
  { id: "units-speed", cluster: "units", prompt: `A train travels 150 km in 1 hour 40 minutes. What is its average speed in km per hour? ${ANSWER_ONLY}`, check: lastNumberIs(90.0) },
  { id: "units-recipe", cluster: "units", prompt: `A recipe for 6 people uses 450 g of flour. Keeping the same proportions, how many grams of flour does the recipe need for 14 people? ${ANSWER_ONLY}`, check: lastNumberIs(1050.0) },
  { id: "units-tank", cluster: "units", prompt: `A tank holds 2.4 cubic meters of water. A pump removes 18 liters per minute. How many whole minutes does it take to empty the tank, rounding up? (1 cubic meter = 1000 liters) ${ANSWER_ONLY}`, check: lastNumberIs(134) },
  { id: "units-fuel", cluster: "units", prompt: `A car uses 7.5 liters of fuel per 100 km. Fuel costs 1.80 dollars per liter. What does a 340 km trip cost in dollars? ${ANSWER_ONLY}`, check: lastNumberIs(45.9) },
  { id: "cal-timezone", cluster: "calendar", prompt: `A meeting starts at 15:30 in a city that is UTC+2. What is the start time in a city that is UTC-5? Answer as HH:MM on a 24-hour clock. ${ANSWER_ONLY}`, check: timeIs("08:30") },
  { id: "cal-duration", cluster: "calendar", prompt: `A flight departs at 22:45 and lands at 06:10 the next day, both in the same time zone. How many minutes long is the flight? ${ANSWER_ONLY}`, check: lastNumberIs(445) },
  { id: "cal-weekday", cluster: "calendar", prompt: `2026-01-01 is a Thursday. What day of the week is 2026-12-25? ${ANSWER_ONLY}`, check: wordIs("Friday") },
  { id: "cal-months", cluster: "calendar", prompt: `What is the date 3 months after 2026-11-30? If the target month has no such day, use its last day. Answer as YYYY-MM-DD. ${ANSWER_ONLY}`, check: dateIs("2027-02-28") },
  { id: "text-vowels", cluster: "text", prompt: `How many vowels (a, e, i, o, u) are in the text "reasoning about encyclopedias"? ${ANSWER_ONLY}`, check: lastNumberIs(12) },
  { id: "text-initials", cluster: "text", prompt: `Take the first letter of each word in "north east south west" and join them into one lowercase word. ${ANSWER_ONLY}`, check: wordIs("nesw") },
  { id: "text-distinct", cluster: "text", prompt: `How many distinct words are in this sentence, ignoring upper and lower case? "The cat saw the Cat and the dog" ${ANSWER_ONLY}`, check: lastNumberIs(5) },
  { id: "text-sort", cluster: "text", prompt: `Sort these words alphabetically, ignoring case, and give them separated by commas: pear, Apple, fig, banana, cherry ${ANSWER_ONLY}`, check: listIs(["apple", "banana", "cherry", "fig", "pear"]) },
  { id: "table-top", cluster: "tables", prompt: `Which region has the highest total units across all months?
region,month,units
north,jan,120
south,jan,90
east,jan,150
north,feb,80
south,feb,210
east,feb,60
north,mar,140
south,mar,50
east,mar,95 ${ANSWER_ONLY}`, check: wordIs("south") },
  { id: "table-average", cluster: "tables", prompt: `What is the average units for the month feb, to two decimals?
region,month,units
north,jan,120
south,jan,90
east,jan,150
north,feb,80
south,feb,210
east,feb,60
north,mar,140
south,mar,50
east,mar,95 ${ANSWER_ONLY}`, check: lastNumberIs(116.67) },
  { id: "table-filter", cluster: "tables", prompt: `How many rows have status failed and retries of 2 or more?
job,status,retries
j1,failed,3
j2,ok,0
j3,failed,1
j4,failed,2
j5,ok,2
j6,failed,5
j7,failed,2
j8,ok,1 ${ANSWER_ONLY}`, check: lastNumberIs(4) },
  { id: "table-join", cluster: "tables", prompt: `Customers (id, city): c1 Oslo, c2 Rome, c3 Oslo, c4 Lima. Orders (customer, amount): c1 40, c2 15, c3 22, c1 8, c4 60, c3 30. What is the total order amount from customers in Oslo? ${ANSWER_ONLY}`, check: lastNumberIs(100) },
  { id: "prob-dice", cluster: "probability", prompt: `Two fair six-sided dice are rolled. What is the probability, as a percentage rounded to one decimal, that the sum is 9? ${ANSWER_ONLY}`, check: lastNumberIs(11.1) },
  { id: "prob-coin", cluster: "probability", prompt: `A fair coin is flipped 3 times. What is the probability, as a percentage, of getting exactly 2 heads? ${ANSWER_ONLY}`, check: lastNumberIs(37.5) },
  { id: "prob-choose", cluster: "probability", prompt: `In how many ways can a committee of 3 be chosen from 8 people? ${ANSWER_ONLY}`, check: lastNumberIs(56) },
  { id: "prob-ace", cluster: "probability", prompt: `A standard deck has 52 cards, 4 of them aces. One card is drawn at random. What is the probability, as a percentage rounded to one decimal, that it is an ace? ${ANSWER_ONLY}`, check: lastNumberIs(7.7) },
  { id: "sql-count", cluster: "sql", prompt: `Table t(id, k, x): (1, 'a', 4), (2, 'a', 2), (3, 'b', 7), (4, 'a', 9), (5, 'b', 1), (6, 'c', 5). What does SELECT COUNT(*) FROM t WHERE x > 3 AND k = 'a' return? ${ANSWER_ONLY}`, check: lastNumberIs(2) },
  { id: "sql-group", cluster: "sql", prompt: `Table t(id, k, x): (1, 'a', 4), (2, 'a', 2), (3, 'b', 7), (4, 'a', 9), (5, 'b', 1), (6, 'c', 5). What is the sum for k = 'a' in SELECT k, SUM(x) FROM t GROUP BY k? ${ANSWER_ONLY}`, check: lastNumberIs(15) },
  { id: "sql-limit", cluster: "sql", prompt: `Table t(id, k, x): (1, 'a', 4), (2, 'a', 2), (3, 'b', 7), (4, 'a', 9), (5, 'b', 1), (6, 'c', 5). SELECT k FROM t ORDER BY x DESC LIMIT 2 returns two rows. Give the two k values in the order returned, separated by commas. ${ANSWER_ONLY}`, check: listIs(["a", "b"]) },
  { id: "sql-having", cluster: "sql", prompt: `Table t(id, k, x): (1, 'a', 4), (2, 'a', 2), (3, 'b', 7), (4, 'a', 9), (5, 'b', 1), (6, 'c', 5). How many rows does SELECT k FROM t GROUP BY k HAVING SUM(x) > 6 return? ${ANSWER_ONLY}`, check: lastNumberIs(2) },
  { id: "fmt-regex", cluster: "formats", prompt: `How many of these strings match the regular expression ^[A-Z]{2}-[0-9]{3}$ : AB-123, ab-123, XY-12, QZ-9876, MN-456, PQ-007, R-100, TT-999? ${ANSWER_ONLY}`, check: lastNumberIs(4) },
  { id: "fmt-csv", cluster: "formats", prompt: `What is the third field of the second line of this CSV?
id,name,city
7,Kai,Bergen
9,Lou,Faro
12,Mia,Kyoto ${ANSWER_ONLY}`, check: wordIs("faro") },
  { id: "fmt-hex", cluster: "formats", prompt: `Convert the hexadecimal number 0xB7 to decimal. ${ANSWER_ONLY}`, check: lastNumberIs(183) },
  { id: "fmt-binary", cluster: "formats", prompt: `Convert the binary number 101101 to decimal. ${ANSWER_ONLY}`, check: lastNumberIs(45) },
  { id: "algo-fib", cluster: "algorithms", prompt: `With F1 = 1 and F2 = 1, what is the Fibonacci number F12? ${ANSWER_ONLY}`, check: lastNumberIs(144) },
  { id: "algo-gcd", cluster: "algorithms", prompt: `What is the greatest common divisor of 168 and 252? ${ANSWER_ONLY}`, check: lastNumberIs(84) },
  { id: "algo-bubble", cluster: "algorithms", prompt: `Apply exactly one left-to-right pass of bubble sort (swap neighbours when the left is larger) to [5, 1, 4, 2, 8]. Give the resulting list as numbers separated by commas. ${ANSWER_ONLY}`, check: numbersTailAre([1, 4, 2, 5, 8]) },
  { id: "algo-digits", cluster: "algorithms", prompt: `What is the sum of the digits of 98765? ${ANSWER_ONLY}`, check: lastNumberIs(35) },
  { id: "read-minutes", cluster: "reading", prompt: `From the incident report, for how many minutes was the checkout service degraded, from the confirmation to the recovery?
Incident report. 09:10 monitoring paged Priya. 09:25 Priya confirmed the checkout service was degraded. 10:05 the fix by Tomas was deployed to half the servers and degradation continued on the rest. 10:40 the fix reached all servers and the service recovered. Ticket T-204 was assigned to Tomas; ticket T-210 was assigned to Priya; ticket T-215 was assigned to Lena. ${ANSWER_ONLY}`, check: lastNumberIs(75) },
  { id: "read-owner", cluster: "reading", prompt: `From the incident report, who was assigned ticket T-210?
Incident report. 09:10 monitoring paged Priya. 09:25 Priya confirmed the checkout service was degraded. 10:05 the fix by Tomas was deployed to half the servers and degradation continued on the rest. 10:40 the fix reached all servers and the service recovered. Ticket T-204 was assigned to Tomas; ticket T-210 was assigned to Priya; ticket T-215 was assigned to Lena. ${ANSWER_ONLY}`, check: wordIs("priya") },
  { id: "read-count", cluster: "reading", prompt: `From the incident report, how many different people are named?
Incident report. 09:10 monitoring paged Priya. 09:25 Priya confirmed the checkout service was degraded. 10:05 the fix by Tomas was deployed to half the servers and degradation continued on the rest. 10:40 the fix reached all servers and the service recovered. Ticket T-204 was assigned to Tomas; ticket T-210 was assigned to Priya; ticket T-215 was assigned to Lena. ${ANSWER_ONLY}`, check: lastNumberIs(3) },
  { id: "read-first", cluster: "reading", prompt: `From the incident report, at what time was the fix first deployed? Answer as HH:MM.
Incident report. 09:10 monitoring paged Priya. 09:25 Priya confirmed the checkout service was degraded. 10:05 the fix by Tomas was deployed to half the servers and degradation continued on the rest. 10:40 the fix reached all servers and the service recovered. Ticket T-204 was assigned to Tomas; ticket T-210 was assigned to Priya; ticket T-215 was assigned to Lena. ${ANSWER_ONLY}`, check: timeIs("10:05") },
];

/** What a run is measured against. It changes when a task, its prompt or its checker changes, and a changed harness is reported as one. */
export function harnessHash(): string {
  const material = TASKS.map((t) => {
    const spec = (t.check as Checker).spec;
    if (spec === undefined) throw new Error(`canary task ${t.id} has a checker with no declared kind and version, so the harness cannot be named without its source text`);
    return `${t.id}\n${t.cluster}\n${t.prompt}\n${JSON.stringify(spec)}`;
  }).join("\n---\n");
  return `v2:sha256:${createHash("sha256").update(material).digest("hex")}`;
}

/**
 * The first name of the harness was a hash of the checkers' source text. Rows recorded under it are the same harness as the one this
 * name stands for, because it was checked that the tasks, prompts and checkers were the same when the second naming was introduced;
 * a stored row with the old name is read as having the new one. The mapping is fixed: it is not recomputed from today's tasks.
 */
export const LEGACY_HARNESS_NAMES: Readonly<Record<string, string>> = {
  "sha256:d320fcfa0c60be6d6a9f72a1d7adfb26d2b9db9cd195d42eec00d2c66116ded7": "v2:sha256:467d9ca39b6011c47b2e2df278ccf6b4bfd82ae77ea4da9842f84bff59fdc4a8",
};

/** The tasks the control arm runs: the first task of each of three clusters, fixed so that the control's own history is comparable day to day. */
export function controlTasks(): CanaryTask[] {
  const seen = new Set<string>();
  const out: CanaryTask[] = [];
  for (const t of TASKS) {
    if (seen.has(t.cluster)) continue;
    seen.add(t.cluster);
    out.push(t);
    if (out.length === 3) break;
  }
  return out;
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
