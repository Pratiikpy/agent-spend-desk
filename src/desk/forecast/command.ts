import type { Ledger } from "../ledger/db.ts";
import { dailySeries, forecastMonth, FORECAST, scorecard, type Daily, type Forecast, type Scorecard } from "./month.ts";

const usd = (micros: number): string => `$${(micros / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The daily list-price estimates of the whole ledger, as a series with zero for a day with no spend; null when the ledger holds none. */
export function loadDaily(db: Ledger): Daily | null {
  const rows = db
    .prepare("SELECT substr(m.ts, 1, 10) AS day, SUM(c.total_micros) AS micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE c.class = 'estimated' GROUP BY day ORDER BY day")
    .all() as unknown as { day: string; micros: number }[];
  return dailySeries(new Map(rows.map((r) => [r.day, r.micros])));
}

export interface MonthForecast {
  forecast: Forecast;
  card: Scorecard;
}

export function monthForecast(db: Ledger): MonthForecast | null {
  const daily = loadDaily(db);
  if (!daily) return null;
  const card = scorecard(daily.values);
  return { forecast: forecastMonth(daily, card), card };
}

const pct = (x: number | null): string => (x === null ? "no forecast could be checked yet" : `${Math.round(x * 100)}%`);

/** The forecast and the record, in words. */
export function renderForecast(m: MonthForecast): string {
  const f = m.forecast;
  const out: string[] = [];
  if (f.daysLeft === 0) {
    out.push(`${f.month}: ${usd(f.spentMicros)} through ${f.asOf}. ${f.note}`);
  } else if (f.method === "linear") {
    out.push(`${f.month}: ${usd(f.spentMicros)} through ${f.asOf}, and on a straight line ${usd(f.pointMicros)} by the end of the month. ${f.note}`);
  } else if (f.lowMicros === null || f.highMicros === null) {
    out.push(`${f.month}: ${usd(f.spentMicros)} through ${f.asOf}, and ${usd(f.pointMicros)} by the end of the month on the weekly pattern. ${f.note}`);
  } else {
    out.push(`${f.month}: ${usd(f.spentMicros)} through ${f.asOf}. Likely ${usd(f.lowMicros)} to ${usd(f.highMicros)} by the end of the month (${FORECAST.level * 100}%), most likely ${usd(f.pointMicros)}, from the weekly pattern of the last ${FORECAST.weeks} weeks and the range of ${f.errorsUsed} forecasts of ${f.daysLeft} days made on your own earlier days.${f.note ? ` ${f.note}` : ""}`);
  }
  out.push("");
  out.push(`The record: the same forecast made on each past day with only what was known then, and checked afterwards (an ${FORECAST.level * 100}% range should hold about 80% of the time).`);
  for (const c of m.card.cohorts) out.push(`  ${c.label}: ${c.n === 0 ? "none checked yet" : `${c.covered} of ${c.n} held (${pct(c.coverage)})`}`);
  out.push(`  the last ${m.card.recent.n} of all lengths: ${m.card.recent.n === 0 ? "none checked yet" : `${m.card.recent.covered} held (${pct(m.card.recent.coverage)})`}. A range that held under ${FORECAST.floor * 100}% of the last ${FORECAST.recent} is widened, and says so.`);
  out.push("These are list-price estimates from logged tokens, not an invoice, and a forecast of spend, not a limit.");
  return out.join("\n");
}

export function forecastCommand(db: Ledger): string {
  const m = monthForecast(db);
  return m ? renderForecast(m) : "The ledger holds no priced call yet, so there is nothing to forecast. Run `desk card` or `desk ingest` first.";
}
