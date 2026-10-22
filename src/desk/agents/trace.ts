import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** `model_reported` is recorded but never shown as an explanation of a decision. */
export type Why = "rule" | "computed" | "model_reported";

export interface TraceEvent {
  /** Closed registry of verbs, see docs/design/desk/00-architecture-master-spec.md section 12.6. */
  event: string;
  why: Why;
  role?: string;
  detail: Record<string, unknown>;
}

export interface Trace {
  emit(event: TraceEvent): void;
  readonly events: readonly TraceLine[];
}

export interface TraceLine extends TraceEvent {
  seq: number;
  t: string;
}

/** Keeps every line in memory and, when given a path, appends it as JSON lines. A write failure never stops a run. */
export class MemoryTrace implements Trace {
  readonly events: TraceLine[] = [];
  private readonly path: string | undefined;
  private readonly clock: () => string;

  constructor(path?: string, clock: () => string = () => new Date().toISOString()) {
    this.path = path;
    this.clock = clock;
    if (path) {
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch {
        /* tracing must not break the run */
      }
    }
  }

  emit(event: TraceEvent): void {
    const line: TraceLine = { seq: this.events.length + 1, t: this.clock(), ...event };
    this.events.push(line);
    if (this.path) {
      try {
        appendFileSync(this.path, JSON.stringify(line) + "\n");
      } catch {
        /* disk full or read-only: keep the in-memory copy */
      }
    }
  }
}

export const NULL_TRACE: Trace = { emit() {}, events: [] };
