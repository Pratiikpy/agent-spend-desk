import React from "react";
import data from "./data.json";
import { C, Card, Count, Frame, Label, Mono, Reveal, capStarts, lin, prog, useSec, usd } from "./kit";
import type { SceneDef } from "./scenes-a";

const { ask, bench, self, verify, gate, zetaris, canary } = data;
const REPO = "github.com/Pratiikpy/agent-spend-desk";
const pctOf = (a: number, b: number) => Math.round((a / b) * 100);

// 6. Ask --------------------------------------------------------------------------------------------------------------
const Ask: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const question = `What changed before ${ask.until}?`;
  const typed = question.slice(0, Math.floor(question.length * lin(t, 0.6, 1.8)));
  const steps = [
    { h: "Risk Router", s: "answer, ask, or abstain" },
    { h: "Planner", s: "writes a typed program" },
    { h: "Specialists", s: "read-only tools" },
    { h: "Auditor", s: `${ask.accepted} accepted, ${ask.rejected} rejected` },
  ];
  const flipAt = cs[1] + 3.6;
  const off = t >= flipAt + 0.9;
  const toggle = prog(t, flipAt, 0.5);
  return (
    <Frame kicker="5 of 8 · Ask, with the engines on and off" caps={caps}>
      <Card style={{ padding: "18px 28px", borderColor: C.ink }}>
        <Mono size={40}>{typed}<span style={{ opacity: Math.floor(t * 2) % 2 ? 0 : 1, color: C.cipher }}>|</span></Mono>
      </Card>
      <div style={{ display: "flex", gap: 0, marginTop: 24, alignItems: "stretch" }}>
        {steps.map((s, i) => (
          <React.Fragment key={s.h}>
            <Reveal at={2.8 + i * 0.7} dy={14} style={{ flex: 1 }}>
              <Card style={{ padding: "14px 22px", height: "100%" }}><div style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.h}</div><div style={{ fontSize: 21, color: C.graphite }}>{s.s}</div></Card>
            </Reveal>
            {i < steps.length - 1 && <div style={{ width: 34, alignSelf: "center", height: 4, background: C.cipher, opacity: prog(t, 3.2 + i * 0.7, 0.3) }} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 28 }}>
        <Reveal at={4.6} style={{ flex: 1 }}>
          <Card style={{ minHeight: 250, borderColor: off ? C.redline : C.cipher, background: off ? "#fff7f3" : C.cipherSoft }}>
            <Label color={off ? C.redline : C.cipher}>{off ? "History engine off" : "History engine on"}</Label>
            {!off && (
              <div style={{ marginTop: 10, fontSize: 30, lineHeight: 1.32 }}>
                {ask.on.slice(0, 3).map((l, i) => <Reveal key={i} at={5.2 + i * 0.9} dy={8} dur={0.5}><div>{l}</div></Reveal>)}
              </div>
            )}
            {off && <Reveal at={flipAt + 0.9} dy={8}><div style={{ marginTop: 10, fontSize: 40, lineHeight: 1.25, letterSpacing: "-0.02em", color: C.redline, fontWeight: 600 }}>{ask.off}</div></Reveal>}
          </Card>
        </Reveal>
        <Reveal at={cs[1] + 0.3} style={{ width: 430 }}>
          <Card style={{ minHeight: 250 }}>
            <Label>Engines, run in our process</Label>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {ask.engines.map((e) => {
                const ablated = e.name === "world_model";
                return (
                  <div key={e.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 26 }}>
                    <Mono size={24}>{e.name}</Mono>
                    <Mono size={22} color={C.graphite}>{e.pass}/{e.of}</Mono>
                    <span style={{ width: 70, height: 32, borderRadius: 16, background: ablated && toggle > 0.5 ? C.line : C.cipher, position: "relative" }}>
                      <span style={{ position: "absolute", top: 4, left: ablated && toggle > 0.5 ? 4 : 42, width: 24, height: 24, borderRadius: 12, background: "#fff" }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </Reveal>
      </div>
    </Frame>
  );
};

// 7. The benchmark ----------------------------------------------------------------------------------------------------
const Bench: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const bars = [
    { h: "One call", n: bench.a0, c: C.line, ink: C.ink },
    { h: "Tool agent", n: bench.a1, c: "#9ca3af", ink: C.ink },
    { h: "The Desk", n: bench.a2, c: C.cipher, ink: C.ink },
  ];
  const max = bench.n;
  const maxH = 420;
  return (
    <Frame kicker="6 of 8 · Same model, three ways" caps={caps}>
      <div style={{ display: "flex", gap: 70 }}>
        <div style={{ flex: "0 0 980px" }}>
          <Label>Exact answers out of {bench.n} questions it never saw</Label>
          <div style={{ display: "flex", gap: 40, marginTop: 14, position: "relative" }}>
            {bars.map((b, i) => {
              const p = prog(t, 1.0 + i * 0.6, 1.4);
              const h = (b.n / max) * maxH * p;
              const ext = i === 2 ? ((bench.a2post - bench.a2) / max) * maxH * prog(t, cs[2] + 0.3, 1.0) : 0;
              return (
                <div key={b.h} style={{ width: 200, textAlign: "center" }}>
                  <div style={{ position: "relative", height: maxH + 100 }}>
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: h + ext + 12, fontSize: 64, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1 }}>
                      {i === 2 ? Math.round(bench.a2 * p + (bench.a2post - bench.a2) * prog(t, cs[2] + 0.3, 1.0)) : <Count to={b.n} at={1.0 + i * 0.6} dur={1.4} />}
                    </div>
                    {ext > 0 && <div style={{ position: "absolute", left: 0, right: 0, bottom: h, height: ext, border: `3px dashed ${C.cipher}`, borderBottom: "none", borderRadius: "10px 10px 0 0" }} />}
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h, background: b.c, borderRadius: "10px 10px 0 0" }} />
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 600, marginTop: 10 }}>{b.h}</div>
                </div>
              );
            })}
            <Reveal at={cs[2] + 0.8} dx={20} dy={0} style={{ position: "absolute", left: 3 * 240 + 10, top: 20, width: 240 }}>
              <div style={{ fontSize: 30, fontWeight: 600, color: C.cipher }}>{bench.a2post} after one fix</div>
              <div style={{ fontSize: 22, color: C.graphite }}>written after set B was read, so shown beside the first figure, never in place of it</div>
            </Reveal>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Reveal at={cs[1] + 3.0}>
            <Label>Asked 3 more times: pass^3</Label>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {[["One call", bench.pass3[0]], ["Tool agent", bench.pass3[1]], ["The Desk", bench.pass3[2]]].map(([h, v]) => (
                <div key={h as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 34 }}><span>{h}</span><Mono size={34} color={h === "The Desk" ? C.cipher : C.ink}>{v}%</Mono></div>
              ))}
            </div>
          </Reveal>
          <Reveal at={cs[2] + 3.0}>
            <Card style={{ marginTop: 26, padding: "18px 24px", borderColor: C.redline }}>
              <div style={{ fontSize: 28, lineHeight: 1.3 }}>{bench.a2 - bench.a1} questions in {bench.n} is at the edge of what this sample can show. The held-out split of 20 is {bench.heldOut[2]} against {bench.heldOut[1]}: inside the noise.</div>
            </Card>
          </Reveal>
        </div>
      </div>
    </Frame>
  );
};

// 8. What it measured about itself ------------------------------------------------------------------------------------
const Self: React.FC<{ caps: string[] }> = ({ caps }) => {
  const cs = capStarts(caps);
  const wt = self.windTunnel;
  const lr = self.learning;
  const wtPct = pctOf(wt.inside, wt.n);
  return (
    <Frame kicker="Self-measurement · what it published against itself" caps={caps}>
      <div style={{ display: "flex", gap: 36 }}>
        <Reveal at={0.3} style={{ flex: 1 }}>
          <Card style={{ borderColor: C.redline, minHeight: 470 }}>
            <Label>Wind tunnel, 90% range</Label>
            <div style={{ fontSize: 200, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1, color: C.redline }}><Count to={wtPct} at={0.6} suffix="%" /></div>
            <div style={{ fontSize: 32, lineHeight: 1.3 }}>of {wt.n} constructed months held inside the range it printed, with a change planted. {pctOf(wt.controlInside, wt.controlN)}% with none.</div>
            <div style={{ marginTop: 14, fontSize: 24, color: C.graphite }}>Shown beside the range on screen, short of its label.</div>
          </Card>
        </Reveal>
        <Reveal at={cs[1] + 0.2} style={{ flex: 1 }}>
          <Card style={{ minHeight: 470 }}>
            <Label>Learning from mistakes</Label>
            <div style={{ fontSize: 200, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1 }}>+<Count to={lr.to - lr.from} at={cs[1] + 0.5} /></div>
            <div style={{ fontSize: 32, lineHeight: 1.3 }}>held-out questions: {lr.from} to {lr.to} of {lr.n}, from {lr.resolved} verified lessons of {lr.mistakes} mistakes.</div>
            <div style={{ marginTop: 14, fontSize: 24, color: C.graphite }}>The interval ({(lr.low * 100).toFixed(1)} to {(lr.high * 100).toFixed(1)} points) touches zero, so no improvement is claimed.</div>
          </Card>
        </Reveal>
      </div>
    </Frame>
  );
};

// 9. Verify offline, then the gate ------------------------------------------------------------------------------------
const Verify: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const tamperAt = cs[1] + 1.6;
  const tampered = t >= tamperAt;
  const steps = tampered ? verify.badSteps : verify.steps;
  const visible = tampered ? steps.length : Math.floor(lin(t, 0.8, 5.5) * steps.length + 0.0001);
  const colour = (s: string) => (s === "PASS" ? C.cipher : s === "FAIL" ? "#fb923c" : "#9ca3af");
  const bad = steps.some((s) => s.status === "FAIL");
  return (
    <Frame kicker="7 of 8 · Approve, verify offline, then the gate" caps={caps}>
      <div style={{ display: "flex", gap: 40 }}>
        <div style={{ flex: "0 0 1050px", background: C.ink, borderRadius: 18, padding: "26px 34px", color: "#fff", minHeight: 330 }}>
          <Label color="#9ca3af">desk-verify · plain Node · network off{tampered ? " · one byte changed" : ""}</Label>
          <div style={{ marginTop: 14, display: "grid", gap: 4 }}>
            {steps.slice(0, visible).map((s) => (
              <div key={s.id} style={{ display: "flex", gap: 26, fontFamily: "'JetBrains Mono', monospace", fontSize: 25 }}>
                <span style={{ width: 70, color: "#9ca3af" }}>{s.id}</span>
                <span style={{ width: 190, color: colour(s.status), fontWeight: 500 }}>{s.status}</span>
                <span style={{ color: "#e5e7eb" }}>{s.label}</span>
              </div>
            ))}
          </div>
          {(visible >= steps.length) && (
            <Reveal at={tampered ? tamperAt + 0.6 : 6.6} dy={8}>
              <div style={{ marginTop: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 30, fontWeight: 500, color: bad ? "#fb923c" : C.cipher }}>RESULT: {bad ? "FAIL" : "PASS"}</div>
              {bad && <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 24, color: "#fb923c" }}>row_hash_mismatch: {verify.row} does not hash to its row_hash</div>}
            </Reveal>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <Reveal at={cs[2]}>
            <Label>The same hook Claude Code calls</Label>
            <div style={{ background: C.ink, color: "#fff", borderRadius: 18, padding: "24px 30px", marginTop: 12 }}>
              <Mono size={24} color="#9ca3af">policy that permits nothing</Mono>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, marginTop: 10, color: "#fb923c" }}>hook exit code {gate.exit}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, marginTop: 6 }}>{gate.message}</div>
            </div>
            <div style={{ marginTop: 18, fontSize: 28, color: C.graphite }}>It fails closed: with no matching permit, the answer is no.</div>
          </Reveal>
        </div>
      </div>
    </Frame>
  );
};

// 10. Where each sponsor sits -----------------------------------------------------------------------------------------
const Sponsors: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const cardAt = [2.2, cs[1], cs[2], cs[2] + 2.8];
  const flow = ["agent logs", "Zetaris", "ledger + Meterless engines", "Nemotron agents", "gate + signed dossier"];
  const cards = [
    { k: "Data layer", h: "Zetaris", p: "One statement over a file silo, a SQL silo and a REST silo: invoices, CI, roster.", off: `Switched off: billed spend falls from ${usd(zetaris.billed, 0)} to $0.` },
    { k: "Memory and history", h: "Meterless", p: `World Model, H-MEM and Markovian engines, run in our process. Conformance ${ask.engines.map((e) => `${e.pass}/${e.of}`).join(", ")}.`, off: "Switched off: what changed becomes unknowable." },
    { k: "Language roles", h: "NVIDIA Nemotron", p: "Drafter, Attacker, Planner, Explainer, the canary and all three benchmark arms.", off: "Switched off: a rule brain answers and the trace says so." },
    { k: "Development", h: "Cursor", p: "The required IDE. Nothing is claimed beyond what its session log records.", off: "" },
  ];
  return (
    <Frame kicker="Where each sponsor sits · Track 3, Reasoning Architecture" caps={caps}>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {flow.map((f, i) => (
          <React.Fragment key={f}>
            <Reveal at={0.3 + i * 0.5} dy={12} style={{ flex: 1 }}>
              <div style={{ background: i === 1 || i === 2 || i === 3 ? C.ink : C.veil, color: i === 1 || i === 2 || i === 3 ? "#fff" : C.ink, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "14px 10px", textAlign: "center", fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>{f}</div>
            </Reveal>
            {i < flow.length - 1 && <div style={{ width: 26, height: 4, background: C.cipher, opacity: prog(t, 0.6 + i * 0.5, 0.3) }} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginTop: 32 }}>
        {cards.map((c, i) => (
          <Reveal key={c.h} at={cardAt[i]} dy={16}>
            <Card style={{ minHeight: 220, padding: "20px 28px", borderColor: i === 3 ? C.line : C.cipher }}>
              <Label color={C.cipher}>{c.k}</Label>
              <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.03em" }}>{c.h}</div>
              <div style={{ fontSize: 24, lineHeight: 1.3, marginTop: 4 }}>{c.p}</div>
              {c.off && <div style={{ fontSize: 21, color: C.graphite, marginTop: 8 }}>{c.off}</div>}
            </Card>
          </Reveal>
        ))}
      </div>
    </Frame>
  );
};

// 11. Close -----------------------------------------------------------------------------------------------------------
const Close: React.FC<{ caps: string[] }> = ({ caps }) => (
  <Frame kicker="Run it on your own logs" caps={caps}>
    <Reveal at={0.2}><div style={{ fontSize: 124, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1 }}>Run it on your own logs.</div></Reveal>
    <Reveal at={1.2}>
      <div style={{ marginTop: 44, display: "inline-block", background: C.ink, color: "#fff", borderRadius: 16, padding: "22px 40px", fontFamily: "'JetBrains Mono', monospace", fontSize: 54 }}>npm run desk</div>
    </Reveal>
    <Reveal at={2.2}><div style={{ marginTop: 34, fontSize: 40, letterSpacing: "-0.02em" }}>Under three minutes. Entirely local. Your autopsy, your ranked fixes, and what it could not know.</div></Reveal>
    <Reveal at={3.2}><div style={{ marginTop: 22, fontSize: 32, color: C.graphite }}>No logs? <Mono size={32} color={C.ink}>npm run desk -- --sample</Mono></div></Reveal>
    <Reveal at={4.2}><div style={{ marginTop: 46, display: "flex", gap: 26, alignItems: "center" }}><Mono size={34}>{REPO}</Mono><span style={{ width: 8, height: 8, background: C.cipher, borderRadius: 4 }} /><span style={{ fontSize: 28, color: C.graphite }}>Zetaris · Meterless · NVIDIA Nemotron · Cursor</span></div></Reveal>
  </Frame>
);

export const scenesB: SceneDef[] = [
  {
    id: "ask", kicker: "", Comp: Ask, min: 17,
    caps: [
      `I ask a question. The Planner writes a typed program, code runs it read-only, the Auditor checks every figure.`,
      `Switch the History engine off and ask again: the answer changes. That is the proof it does something.`,
    ],
  },
  {
    id: "bench", kicker: "", Comp: Bench,
    caps: [
      `${bench.n} unseen questions, pre-registered: one call, a tool agent and the Desk, on one Nemotron model.`,
      `The Desk answered ${bench.a2} exactly. The tool agent, ${bench.a1}. One call, ${bench.a0}.`,
      `A fix found by reading the misses lifts the Desk to ${bench.a2post}: post hoc, shown beside the first figure.`,
    ],
  },
  {
    id: "self", kicker: "", Comp: Self,
    caps: [
      `The Desk also scores itself: its 90% one-month range held the real month ${pctOf(self.windTunnel.inside, self.windTunnel.n)}% of the time.`,
      `Learning from mistakes moved ${self.learning.to - self.learning.from} of ${self.learning.n}: no improvement claimed.`,
    ],
  },
  {
    id: "verify", kicker: "", Comp: Verify, min: 17,
    caps: [
      `To apply the policy I echo the action digest; the dossier carries the rows its figures come from.`,
      `A stranger verifies it on plain Node, network off. Change one byte and it names the row.`,
      `The same hook Claude Code calls blocked a real Bash call.`,
    ],
  },
  {
    id: "close", kicker: "", Comp: Close, min: 9,
    caps: [`Everything here is in the repository: the code, the recordings, the pre-registration, and what failed.`],
  },
];
