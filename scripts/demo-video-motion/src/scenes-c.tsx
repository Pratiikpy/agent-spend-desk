import React from "react";
import { C, Card, Frame, Label, Mono, Reveal, capStarts, prog, useSec } from "./kit";
import type { SceneDef } from "./scenes-a";

// One product, three tracks ------------------------------------------------------------------------------------------
const TRACKS = [
  { n: 1, h: "Fragmented intelligence" },
  { n: 2, h: "Explain why" },
  { n: 3, h: "Reasoning architecture", primary: true },
];

type NodeDef = { h: string; s: string; tracks: number[]; dark?: boolean };
const COLS: { k: string; nodes: NodeDef[] }[] = [
  { k: "Sources", nodes: [
    { h: "Agent logs", s: "Claude Code and others", tracks: [1] },
    { h: "Invoices", s: "files in a bucket", tracks: [1] },
    { h: "CI facts", s: "Postgres", tracks: [1] },
    { h: "Roster", s: "REST", tracks: [1] },
  ] },
  { k: "Data", nodes: [
    { h: "Zetaris", s: "one statement over three silos", tracks: [1], dark: true },
    { h: "Ledger", s: "SQLite, every dollar classed", tracks: [1] },
    { h: "Landing ladder", s: "what each dollar bought", tracks: [1] },
  ] },
  { k: "Reasoning", nodes: [
    { h: "Router, Planner, critic", s: "a typed program", tracks: [3] },
    { h: "Specialists", s: "read-only, code does the sums", tracks: [2, 3] },
    { h: "Auditor and Explainer", s: "no unsupported figure", tracks: [2, 3] },
    { h: "Drafter, check, Attacker", s: "replay on a held-out month", tracks: [3] },
    { h: "Canary", s: "daily, with a control arm", tracks: [3] },
  ] },
  { k: "Decide", nodes: [
    { h: "Gate", s: "reserve, hook, MCP", tracks: [3] },
    { h: "Signed dossier", s: "rows, hashes, signature", tracks: [2] },
    { h: "desk-verify", s: "offline, plain Node", tracks: [2] },
  ] },
];

const Architecture: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  // Which track is in focus follows the caption being read.
  let focus = 0;
  for (let i = 0; i < 3; i++) if (t >= cs[i]) focus = i + 1;
  const wrapUp = t >= cs[3];
  const dim = (tracks: number[]) => (focus === 0 || wrapUp ? 1 : tracks.includes(focus) ? 1 : 0.32);
  const lit = (tracks: number[]) => focus !== 0 && !wrapUp && tracks.includes(focus);
  return (
    <Frame kicker="One product, three tracks · the architecture" caps={caps}>
      <div style={{ display: "flex", gap: 18, marginBottom: 18 }}>
        {TRACKS.map((tr, i) => {
          const on = !wrapUp && focus === tr.n;
          return (
            <Reveal key={tr.n} at={0.2 + i * 0.25} dy={10} style={{ flex: tr.primary ? 1.25 : 1 }}>
              <div style={{ border: `2px solid ${on ? C.ink : C.line}`, background: on ? C.ink : C.paper, color: on ? "#fff" : C.ink, borderRadius: 14, padding: "10px 20px", transition: "none" }}>
                <Label color={on ? "#9ca3af" : C.graphite} style={{ fontSize: 18 }}>Track {tr.n}{tr.primary ? " · primary" : ""}</Label>
                <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{tr.h}</div>
              </div>
            </Reveal>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
        {COLS.map((col, ci) => (
          <React.Fragment key={col.k}>
            <div style={{ flex: 1 }}>
              <Reveal at={0.5 + ci * 0.3} dy={10}><Label style={{ marginBottom: 8, fontSize: 18 }}>{col.k}</Label></Reveal>
              <div style={{ display: "grid", gap: 8 }}>
                {col.nodes.map((n, ni) => (
                  <Reveal key={n.h} at={0.7 + ci * 0.3 + ni * 0.12} dy={10} dur={0.5}>
                    <div style={{ opacity: n.dark ? Math.max(dim(n.tracks), 0.55) : dim(n.tracks), border: `${lit(n.tracks) ? 4 : 2}px solid ${lit(n.tracks) ? C.cipher : n.dark ? C.ink : C.line}`, background: n.dark ? C.ink : lit(n.tracks) ? C.cipherSoft : C.paper, color: n.dark ? "#fff" : C.ink, borderRadius: 12, padding: lit(n.tracks) && n.dark ? "6px 14px" : "8px 16px" }}>
                      <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{n.h}</div>
                      <div style={{ fontSize: 17, color: n.dark ? "#d1d5db" : C.graphite }}>{n.s}</div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
            {ci < COLS.length - 1 && <div style={{ width: 34, alignSelf: "center", height: 4, background: C.cipher, opacity: prog(t, 1.0 + ci * 0.3, 0.4) }} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 18 }}>
        <Reveal at={1.8} style={{ flex: 1 }}>
          <div style={{ opacity: dim([3]), border: `2px solid ${lit([3]) ? C.cipher : C.line}`, background: lit([3]) ? C.cipherSoft : C.veil, borderRadius: 12, padding: "8px 18px", fontSize: 22 }}><b>Meterless engines</b> · World Model, H-MEM, Markovian: memory and history, run in our process</div>
        </Reveal>
        <Reveal at={2.0} style={{ flex: 1 }}>
          <div style={{ opacity: dim([3]), border: `2px solid ${lit([3]) ? C.cipher : C.line}`, background: lit([3]) ? C.cipherSoft : C.veil, borderRadius: 12, padding: "8px 18px", fontSize: 22 }}><b>NVIDIA Nemotron</b> · every language role: Planner, Explainer, Drafter, Attacker, canary</div>
        </Reveal>
        {wrapUp && (
          <Reveal at={cs[3]} style={{ flex: "0 0 330px" }}>
            <div style={{ border: `2px solid ${C.line}`, background: C.veil, borderRadius: 12, padding: "8px 18px", fontSize: 22 }}><b>Cursor</b> · the required IDE</div>
          </Reveal>
        )}
      </div>
    </Frame>
  );
};

// Where it goes --------------------------------------------------------------------------------------------------------
const NEXT = [
  { h: "A measured trial on real tasks.", s: "The Lab is built; its feasibility spike has not finished, so no policy's effect on real work has been measured." },
  { h: "More tools, read and stopped.", s: "Copilot's store holds no token counts; the Anthropic gateway route has not met the real API." },
  { h: "A better range.", s: "A one-month range that holds as often as it says." },
  { h: "Open formats.", s: "The ledger and the dossier as a published standard other desks can write." },
];

const Vision: React.FC<{ caps: string[] }> = ({ caps }) => {
  const cs = capStarts(caps);
  return (
    <Frame kicker="Where it goes · none of this is done yet" caps={caps}>
      <Reveal at={0.2}><div style={{ fontSize: 100, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1 }}>From a desk to a gate<br />for every agent.</div></Reveal>
      <div style={{ marginTop: 36, display: "grid", gap: 12 }}>
        {NEXT.map((n, i) => (
          <Reveal key={n.h} at={cs[1] + 0.2 + i * 0.7} dx={-24} dy={0}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
              <span style={{ width: 44, height: 8, background: C.cipher, borderRadius: 4, alignSelf: "center", flex: "none" }} />
              <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em", flex: "none" }}>{n.h}</span>
              <Mono size={20} color={C.graphite} style={{ lineHeight: 1.3 }}>{n.s}</Mono>
            </div>
          </Reveal>
        ))}
      </div>
    </Frame>
  );
};

export const scenesC: Record<"architecture" | "vision", SceneDef> = {
  architecture: {
    id: "architecture", kicker: "", Comp: Architecture,
    caps: [
      "Track 1: logs, invoices, CI and a roster joined through Zetaris, with the conflicts shown.",
      "Track 2: every answer is a checked program, every conclusion a signed dossier.",
      "Track 3, our primary: plan, critique, revise, replay on a month it never saw.",
      "Cursor is the required IDE; nothing is claimed beyond its log.",
    ],
  },
  vision: {
    id: "vision", kicker: "", Comp: Vision,
    caps: [
      "Where it goes: from a desk to a gate for every agent.",
      "Not built yet: a measured trial on real tasks, a better range, and an open format.",
    ],
  },
};
