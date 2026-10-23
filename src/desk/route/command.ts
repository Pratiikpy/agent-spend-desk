import { existsSync } from "node:fs";

import { readRows } from "../canary/store.ts";
import { Price, renderRoute, routeReplay } from "./replay.ts";

export interface RouteOptions {
  runsPath: string;
  tolerance: number;
  /** "in:out" dollars per million tokens. */
  priceStrong?: string;
  priceCheap?: string;
}

function parsePrice(s: string | undefined): Price | null | "bad" {
  if (s === undefined) return null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s);
  return m ? { inPerM: Number(m[1]), outPerM: Number(m[2]) } : "bad";
}

/** `desk route`: the recorded canary tasks replayed as two routes, with a screen for which kinds of task could go to the cheaper model. */
export function routeCommand(o: RouteOptions): string {
  if (!existsSync(o.runsPath)) return `No recorded tasks at ${o.runsPath}. Route replay reads the canary's runs: record them with scripts/canary-record.ts, or use --sample.`;
  if (!(o.tolerance >= 0 && o.tolerance <= 0.5)) return "--tolerance is a fraction from 0 to 0.5, for example 0.1 for ten points.";
  const s = parsePrice(o.priceStrong);
  const c = parsePrice(o.priceCheap);
  if (s === "bad" || c === "bad") return "A price is input:output dollars per million tokens, for example 0.2:0.6.";
  if ((s === null) !== (c === null)) return "Give both --price-strong and --price-cheap, or neither.";
  const report = routeReplay(readRows(o.runsPath).rows, { tolerance: o.tolerance, ...(s && c ? { price: { strong: s, cheap: c } } : {}) });
  return report ? renderRoute(report) : "The recorded tasks were served by fewer than two models, so there is no second route to replay them on.";
}
