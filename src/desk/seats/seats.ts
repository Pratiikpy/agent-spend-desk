import type { ReplaySession } from "../replay/policy-replay.ts";
import { teamOfProject, type RosterFact } from "../silo/facts.ts";

/**
 * Seat return: a team pays for a number of seats; some of those seats' holders landed nothing in the recent window.
 * A seat is "active" if its holder landed at least one session in the window. The roster says how many seats a team
 * holds and at what price; the ledger says who landed work. The Desk reports the seats beyond the active people, with
 * the dollars they cost per month, and never names a person as idle: the holder of a seat may have been on leave,
 * on a task that does not leave a commit, or using another tool. It is a question for the team lead, with figures.
 */
export interface SeatPerson {
  person: string;
  landedSessions: number;
  sessions: number;
  spendMicros: number;
  lastLandedDay: string | null;
}

export interface SeatLine {
  team: string;
  seatPlan: string;
  seats: number;
  seatPriceUsd: number | null;
  /** People who ran sessions in the team's repositories in the window. */
  people: SeatPerson[];
  activePeople: number;
  /** Seats beyond the people who landed work. */
  idleSeats: number;
  /** What those seats cost a month, when the roster carries a price. */
  idleUsdPerMonth: number | null;
}

export interface SeatOptions {
  asOfMs: number;
  windowDays: number;
}

const DAY = 86_400_000;

export function seatReturn(sessions: readonly ReplaySession[], roster: readonly RosterFact[], o: SeatOptions): SeatLine[] {
  const from = o.asOfMs - o.windowDays * DAY;
  const byTeam = new Map<string, Map<string, SeatPerson>>();
  for (const s of sessions) {
    if (s.startMs < from || s.startMs > o.asOfMs) continue;
    const team = teamOfProject(s.project);
    if (!team) continue;
    const people = byTeam.get(team) ?? new Map<string, SeatPerson>();
    const p = people.get(s.person) ?? { person: s.person, landedSessions: 0, sessions: 0, spendMicros: 0, lastLandedDay: null };
    p.sessions += 1;
    p.spendMicros += s.calls.reduce((t, c) => t + c.costMicros, 0);
    if (s.landed) {
      p.landedSessions += 1;
      const day = new Date(s.startMs).toISOString().slice(0, 10);
      if (p.lastLandedDay === null || day > p.lastLandedDay) p.lastLandedDay = day;
    }
    people.set(s.person, p);
    byTeam.set(team, people);
  }
  return roster
    .map((r) => {
      const people = [...(byTeam.get(r.team)?.values() ?? [])].sort((a, b) => b.landedSessions - a.landedSessions || a.person.localeCompare(b.person));
      const active = people.filter((p) => p.landedSessions > 0).length;
      const idle = Math.max(0, r.seats - active);
      return { team: r.team, seatPlan: r.seatPlan, seats: r.seats, seatPriceUsd: r.seatPriceUsd, people, activePeople: active, idleSeats: idle, idleUsdPerMonth: r.seatPriceUsd === null ? null : Math.round(idle * r.seatPriceUsd * 100) / 100 };
    })
    .sort((a, b) => a.team.localeCompare(b.team));
}

export function renderSeats(lines: readonly SeatLine[], o: SeatOptions): string {
  const out: string[] = [];
  out.push(`Seats, ${o.windowDays} days up to ${new Date(o.asOfMs).toISOString().slice(0, 10)}: a seat is active when its holder landed work in the window`);
  let idle = 0;
  let usd = 0;
  let priced = true;
  for (const l of lines) {
    idle += l.idleSeats;
    if (l.idleUsdPerMonth === null) priced = false;
    else usd += l.idleUsdPerMonth;
    out.push(`  ${l.team.padEnd(11)} ${String(l.seats).padStart(2)} seats ${l.seatPlan.padEnd(14)} ${String(l.activePeople).padStart(2)} people landed work here   ${l.idleSeats === 0 ? "no seat to return" : `${l.idleSeats} seat${l.idleSeats === 1 ? "" : "s"} beyond them${l.idleUsdPerMonth === null ? "" : `, $${l.idleUsdPerMonth.toFixed(2)} a month`}`}`);
  }
  out.push("");
  out.push(idle === 0 ? "No team holds more seats than it has people who landed work." : `${idle} seat${idle === 1 ? "" : "s"} beyond the people who landed work${priced ? `, $${usd.toFixed(2)} a month at the roster's seat prices` : ""}. That is a question for each team lead, not a verdict on anyone.`);
  out.push("People are counted by the repositories they worked in, so one person can appear under several teams. Not known: whether a holder was away, worked on something that leaves no commit, or uses another tool. Seat prices are synthetic roster values.");
  return out.join("\n");
}
