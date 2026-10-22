export class BudgetError extends Error {
  readonly code = "E_BUDGET_EXCEEDED";
  constructor(readonly what: "wall_clock" | "model_calls" | "tool_calls" | "turns", detail: string) {
    super(`E_BUDGET_EXCEEDED: ${what}: ${detail}`);
    this.name = "BudgetError";
  }
}

export interface BudgetLimits {
  wallClockMs: number;
  modelCalls: number;
  toolCalls: number;
  turns: number;
  /** Cap for one model call. The real deadline is the smaller of this and the time left. */
  callDeadlineMs: number;
}

/** Defaults from the spec (12.3) for Ask-the-Desk, live. SAMPLE_MODE uses a shorter wall clock. */
export const ASK_LIVE: BudgetLimits = { wallClockMs: 180_000, modelCalls: 8, toolCalls: 10, turns: 6, callDeadlineMs: 60_000 };
export const ASK_SAMPLE: BudgetLimits = { ...ASK_LIVE, wallClockMs: 60_000 };
export const DRAFT_LIVE: BudgetLimits = { wallClockMs: 240_000, modelCalls: 8, toolCalls: 20, turns: 8, callDeadlineMs: 60_000 };

/** Limits enforced in code. Retries count as model calls. */
export class Budget {
  private readonly startedAt: number;
  private models = 0;
  private tools = 0;
  private turnCount = 0;

  constructor(readonly limits: BudgetLimits, private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  remainingMs(): number {
    return this.limits.wallClockMs - (this.now() - this.startedAt);
  }

  /** The deadline for the next model call: min(per-call cap, time left). Throws when no time is left. */
  nextCallDeadlineMs(): number {
    const left = this.remainingMs();
    if (left <= 0) throw new BudgetError("wall_clock", `${this.limits.wallClockMs} ms used`);
    return Math.min(this.limits.callDeadlineMs, left);
  }

  useModelCall(): void {
    if (this.models >= this.limits.modelCalls) throw new BudgetError("model_calls", `${this.limits.modelCalls} used`);
    this.models += 1;
  }

  useToolCall(): void {
    if (this.tools >= this.limits.toolCalls) throw new BudgetError("tool_calls", `${this.limits.toolCalls} used`);
    this.tools += 1;
  }

  useTurn(): void {
    if (this.turnCount >= this.limits.turns) throw new BudgetError("turns", `${this.limits.turns} used`);
    this.turnCount += 1;
  }

  used(): { modelCalls: number; toolCalls: number; turns: number; elapsedMs: number } {
    return { modelCalls: this.models, toolCalls: this.tools, turns: this.turnCount, elapsedMs: this.now() - this.startedAt };
  }
}
