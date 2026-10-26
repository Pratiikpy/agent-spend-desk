import React from "react";
import data from "./data.json";
import { C, Card, Count, Frame, Label, Mono, Pop, Reveal, capStarts, lin, prog, useSec, usd } from "./kit";
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
    { h: "One call", n: bench.a0, c: C.line },
    { h: "Tool agent", n: bench.a1, c: "#9ca3af" },
    { h: "The Desk", n: bench.a2, c: C.cipher },
  ];
  const max = bench.n;
  const maxH = 430;
  const missed = bench.n - bench.a2;
  return (
    <Frame kicker="6 of 8 · Same model, three ways" caps={caps}>
      <div style={{ display: "flex", gap: 70 }}>
        <div style={{ flex: "0 0 900px" }}>
          <Label>Exact answers out of {bench.n} questions nobody had read</Label>
          <div style={{ display: "flex", gap: 44, marginTop: 14, position: "relative" }}>
            {[0.25, 0.5, 0.75, 1].map((g) => <div key={g} style={{ position: "absolute", left: 0, right: 0, bottom: 62 + maxH * g, borderTop: `1px dashed ${C.line}` }} />)}
            {bars.map((b, i) => {
              const p = prog(t, 1.0 + i * 0.7, 1.5);
              const h = (b.n / max) * maxH * p;
              return (
                <div key={b.h} style={{ width: 230, textAlign: "center", position: "relative" }}>
                  <div style={{ position: "relative", height: maxH + 100 }}>
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: h + 12, fontSize: 84, fontWeight: 600, letterSpacing: "-0.06em", lineHeight: 1, color: i === 2 ? C.cipher : C.ink }}>
                      <Count to={b.n} at={1.0 + i * 0.7} dur={1.5} />
                    </div>
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h, background: b.c, borderRadius: "12px 12px 0 0" }} />
                    {i === 2 && p > 0.98 && <div style={{ position: "absolute", left: 0, right: 0, bottom: h - 6, height: 6, background: C.ink, opacity: 0.12 }} />}
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 600, marginTop: 10 }}>{b.h}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Reveal at={cs[1] + 0.2}>
            <Label>Seven predictions, written first</Label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {Array.from({ length: bench.predictions }, (_, i) => (
                <Pop key={i} at={cs[1] + 0.5 + i * 0.22} dur={0.4}>
                  <div style={{ width: 52, height: 52, borderRadius: 12, background: C.cipher, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 600 }}>{"✓"}</div>
                </Pop>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 24 }}>All {bench.predictions} held.</div>
          </Reveal>
          <Reveal at={cs[1] + 1.8}>
            <Label style={{ marginTop: 26 }}>Asked three more times: pass^3</Label>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {[["One call", bench.pass3[0]], ["Tool agent", bench.pass3[1]], ["The Desk", bench.pass3[2]]].map(([h, v]) => (
                <div key={h as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 32 }}><span>{h}</span><Mono size={32} color={h === "The Desk" ? C.cipher : C.ink}>{v}%</Mono></div>
              ))}
            </div>
          </Reveal>
          <Reveal at={cs[2] + 0.3}>
            <Card style={{ marginTop: 24, padding: "16px 22px", borderColor: C.redline }}>
              <div style={{ fontSize: 25, lineHeight: 1.3 }}>The {missed} it missed are the shapes it has no step for. {bench.a2 - bench.a1} in {bench.n} is a margin this sample cannot make certain: on the held-out 20 it is {bench.heldOut[2]} against {bench.heldOut[1]}.</div>
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
  const t = useSec();
  // 64 constructed months as a strip: those inside the printed range filled, those outside left open.
  const dots = Array.from({ length: wt.n }, (_, i) => i < wt.inside);
  return (
    <Frame kicker="Self-measurement · what it published against itself" caps={caps}>
      <div style={{ display: "flex", gap: 36 }}>
        <Reveal at={0.3} style={{ flex: 1 }}>
          <Card style={{ borderColor: C.redline, minHeight: 520 }}>
            <Label>Wind tunnel, labelled 90%</Label>
            <div style={{ fontSize: 190, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1, color: C.redline }}><Count to={wtPct} at={0.6} suffix="%" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: 6, margin: "10px 0 14px" }}>
              {dots.map((inside, i) => {
                const p = prog(t, 1.0 + i * 0.03, 0.3);
                return <span key={i} style={{ height: 22, borderRadius: 6, background: inside ? C.ink : "transparent", border: `2px solid ${inside ? C.ink : C.redline}`, opacity: p, transform: `scale(${0.6 + 0.4 * p})` }} />;
              })}
            </div>
            <div style={{ fontSize: 28, lineHeight: 1.3 }}>of {wt.n} constructed months held inside the range it printed, with a change planted. {pctOf(wt.controlInside, wt.controlN)}% with none.</div>
            <div style={{ marginTop: 10, fontSize: 22, color: C.graphite }}>Shown beside the range on screen, short of its label.</div>
          </Card>
        </Reveal>
        <Reveal at={cs[1] + 0.2} style={{ flex: 1 }}>
          <Card style={{ minHeight: 520 }}>
            <Label>Learning from mistakes, the earlier Desk</Label>
            <div style={{ fontSize: 190, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1 }}>+<Count to={lr.to - lr.from} at={cs[1] + 0.5} /></div>
            <div style={{ fontSize: 28, lineHeight: 1.3, marginTop: 24 }}>held-out questions: {lr.from} to {lr.to} of {lr.n}, from {lr.resolved} verified lessons of {lr.mistakes} mistakes.</div>
            <div style={{ marginTop: 12, fontSize: 22, color: C.graphite }}>The interval ({lr.low.toFixed(1)} to {lr.high.toFixed(1)} points) touches zero, so no improvement is claimed. On the current Desk the same run finds {lr.currentMistakes} mistakes to learn from.</div>
          </Card>
        </Reveal>
      </div>
    </Frame>
  );
};

// 9. Verify offline ---------------------------------------------------------------------------------------------------
const Verify: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const tamperAt = cs[1] + 1.6;
  const tampered = t >= tamperAt;
  const steps = tampered ? verify.badSteps : verify.steps;
  const visible = tampered ? steps.length : Math.floor(lin(t, 0.8, 5.5) * steps.length + 0.0001);
  const colour = (s: string) => (s === "PASS" ? C.cipher : s === "FAIL" ? "#fb923c" : "#9ca3af");
  const bad = steps.some((s) => s.status === "FAIL");
  const flash = tampered ? Math.max(0, 1 - (t - tamperAt) * 2.4) : 0;
  return (
    <Frame kicker="7 of 8 · Approve, then verify offline" caps={caps}>
      <div style={{ display: "flex", gap: 40 }}>
        <div style={{ flex: "0 0 1080px", background: C.ink, borderRadius: 18, padding: "26px 34px", color: "#fff", minHeight: 400, position: "relative", boxShadow: flash > 0 ? `0 0 0 ${flash * 14}px rgba(251,146,60,${flash * 0.5})` : undefined }}>
          <Label color="#9ca3af">desk-verify · plain Node · network off{tampered ? " · one byte changed" : ""}</Label>
          <div style={{ marginTop: 14, display: "grid", gap: 5 }}>
            {steps.slice(0, visible).map((s) => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "96px 250px 1fr", fontFamily: "'JetBrains Mono', monospace", fontSize: 23, lineHeight: 1.25 }}>
                <span style={{ color: "#9ca3af" }}>{s.id}</span>
                <span style={{ color: colour(s.status), fontWeight: 500 }}>{s.status}</span>
                <span style={{ color: "#e5e7eb" }}>{s.label}</span>
              </div>
            ))}
          </div>
          {(visible >= steps.length) && (
            <Reveal at={tampered ? tamperAt + 0.6 : 6.6} dy={8}>
              <div style={{ marginTop: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 30, fontWeight: 500, color: bad ? "#fb923c" : C.cipher }}>RESULT: {bad ? "FAIL" : "PASS"}</div>
              {bad && (verify.badErrors as string[]).map((e) => <div key={e} style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: "#fb923c" }}>{e}</div>)}
            </Reveal>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <Reveal at={cs[2]}>
            <Label>What a signature proves</Label>
            <div style={{ fontSize: 28, lineHeight: 1.3, marginTop: 10 }}>The record was not altered after signing, and its figures follow from its rows.</div>
          </Reveal>
          <Reveal at={cs[2] + 1.6}>
            <Label color={C.redline} style={{ marginTop: 28 }}>What it does not prove</Label>
            <div style={{ fontSize: 28, lineHeight: 1.3, marginTop: 10 }}>That the agent logs it started from were truthful.</div>
          </Reveal>
        </div>
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
    <Reveal at={3.2}><div style={{ marginTop: 22, fontSize: 32, color: C.graphite }}>No logs? <Mono size={32} color={C.ink}>npm run desk -- --sample</Mono> &nbsp;or open the screens in a browser: <Mono size={32} color={C.ink}>desk-demo.vercel.app</Mono></div></Reveal>
    <Reveal at={4.2}><div style={{ marginTop: 46, display: "flex", gap: 26, alignItems: "center" }}><Mono size={34}>{REPO}</Mono><span style={{ width: 8, height: 8, background: C.cipher, borderRadius: 4 }} /><span style={{ fontSize: 28, color: C.graphite }}>Zetaris · Meterless · NVIDIA Nemotron · Cursor</span></div></Reveal>
    <Reveal at={5.2}><div style={{ marginTop: 18, fontSize: 26, color: C.graphite }}>{data.product.features.built} of {data.product.features.of} features built · {data.product.prove.windows.pass} checks pass · fresh Windows and Ubuntu clones · Track 3, Reasoning Architecture</div></Reveal>
  </Frame>
);

export const scenesB: SceneDef[] = [
  {
    id: "ask", kicker: "", Comp: Ask, min: 15,
    caps: [
      `I ask a question. The Planner writes a typed program, code runs it read-only, the Auditor checks every figure.`,
      `Switch the History engine off and ask again: the answer changes. That is the proof it does something.`,
    ],
  },
  {
    id: "bench", kicker: "", Comp: Bench,
    caps: [
      `${bench.n} unread questions, preregistered: one Nemotron model, used three ways.`,
      `The Desk answered ${bench.a2} exactly. The tool agent, ${bench.a1}. One call, ${bench.a0}. All ${bench.predictions} written predictions held.`,
      `Its misses are shapes it has no step for; ${bench.a2 - bench.a1} in ${bench.n} is a margin this sample cannot make certain.`,
    ],
  },
  {
    id: "self", kicker: "", Comp: Self,
    caps: [
      `The Desk also scores itself: its 90% one-month range held the real month ${pctOf(self.windTunnel.inside, self.windTunnel.n)}% of the time.`,
      `Learning from mistakes moved ${self.learning.to - self.learning.from} of ${self.learning.n} on the earlier Desk: no improvement claimed.`,
    ],
  },
  {
    id: "verify", kicker: "", Comp: Verify, min: 13,
    caps: [
      `To apply the policy I echo the action digest; the dossier carries its rows.`,
      `A stranger verifies it offline on plain Node. One changed byte names the row.`,
      `A signature proves it is unaltered, not that the logs were true.`,
    ],
  },
  {
    id: "close", kicker: "", Comp: Close, min: 8,
    caps: [`Everything here is in the repository: the code, the recordings, the pre-registration, and what failed.`],
  },
];
