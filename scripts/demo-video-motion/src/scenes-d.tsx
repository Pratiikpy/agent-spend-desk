import React from "react";
import { Img, staticFile } from "remotion";
import data from "./data.json";
import { C, Card, Count, Frame, Label, MONO, Mono, Pill, Pop, Reveal, capStarts, lin, prog, useSec } from "./kit";
import type { SceneDef } from "./scenes-a";

const { product, self } = data;
const fmt = (n: number) => n.toLocaleString("en-US");

// The real screens, panned ---------------------------------------------------------------------------------------------
const SCREENS: { img: string; h: string; s: string }[] = [
  { img: "brief", h: "Brief", s: "Yesterday, and the one change worth making" },
  { img: "week", h: "Week", s: "The week against the one before" },
  { img: "bill", h: "Bill", s: "Every dollar classed: billed, estimated, unpriced" },
  { img: "autopsy", h: "Autopsy", s: "A window split by cause" },
  { img: "sessions", h: "Sessions", s: "Each session and what it landed" },
  { img: "outcomes", h: "Outcomes", s: "Kept, merged, reverted, unlinked" },
  { img: "policy", h: "Policy", s: "A spend policy, narrowed only" },
  { img: "canary", h: "Canary", s: "Is the agent still as good" },
  { img: "ask", h: "Ask", s: "Every figure from a typed step" },
  { img: "organisation", h: "Org data", s: "Invoices, CI and roster, joined" },
  { img: "team", h: "Team", s: "Roles, caps, signed reports" },
  { img: "dossiers", h: "Dossiers", s: "Signed, verifiable offline" },
  { img: "evidence", h: "Evidence", s: "What it measured about itself" },
  { img: "sources", h: "Doctor", s: "What it can read, and what it cannot" },
];
const SHOT = 1.2;

const UiTour: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const idx = Math.max(0, Math.min(SCREENS.length - 1, Math.floor((t - 0.3) / SHOT)));
  const VIEW_W = 1060;
  const VIEW_H = 560;
  const scale = VIEW_W / 1410;
  return (
    <Frame kicker="The product · fourteen screens, one local server" caps={caps}>
      <div style={{ display: "flex", gap: 44, alignItems: "center" }}>
        <div style={{ flex: `0 0 ${VIEW_W}px` }}>
          <div style={{ border: `2px solid ${C.line}`, borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 30px 60px rgba(10,10,10,0.10)" }}>
            <div style={{ height: 46, background: C.veil, borderBottom: `2px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10, padding: "0 18px" }}>
              {[0, 1, 2].map((d) => <span key={d} style={{ width: 13, height: 13, borderRadius: 7, background: "#d1d5db" }} />)}
              <span style={{ marginLeft: 18, fontFamily: MONO, fontSize: 18, color: C.graphite }}>127.0.0.1 / {SCREENS[idx].img} · read-only · local</span>
            </div>
            <div style={{ position: "relative", height: VIEW_H, overflow: "hidden" }}>
              {SCREENS.map((s, i) => {
                const start = 0.3 + i * SHOT;
                const local = (t - start) / SHOT;
                const enter = prog(t, start, 0.28);
                const leave = i === SCREENS.length - 1 ? 0 : prog(t, start + SHOT - 0.12, 0.2);
                const shift = (1 - enter) * 90 - leave * 90;
                const pan = Math.min(1, Math.max(0, local));
                const imgH = 1500 * scale;
                const travel = Math.max(0, Math.min(imgH - VIEW_H, 260));
                return (
                  <div key={s.img} style={{ position: "absolute", inset: 0, opacity: enter * (1 - leave), transform: `translateX(${shift}px)` }}>
                    <Img src={staticFile(`img/ui/${s.img}.jpg`)} style={{ width: VIEW_W, display: "block", transform: `translateY(${-travel * pan}px)` }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
          {SCREENS.map((s, i) => (
            <Reveal key={s.img} at={0.2 + i * 0.05} dy={6} dur={0.4}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "3px 0 3px 16px", borderLeft: `6px solid ${i === idx ? C.cipher : C.line}`, opacity: i === idx ? 1 : i < idx ? 0.55 : 0.35 }}>
                <Mono size={18} color={C.graphite}>{String(i + 1).padStart(2, "0")}</Mono>
                <span style={{ fontSize: i === idx ? 31 : 25, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.h}</span>
                {i === idx && <span style={{ fontSize: 19, color: C.graphite }}>{s.s}</span>}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Frame>
  );
};

// The gate, in every tool ---------------------------------------------------------------------------------------------
const levelTone = (l: string): "good" | "plain" | "bad" => (l === "enforced" ? "good" : l === "advisory" ? "plain" : "bad");

const Gate: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const live = product.enforcement.filter((e) => e.level === "enforced");
  const rows = product.enforcement;
  // A tool call travels to the gate and is stopped; then one that a permit covers goes through.
  const stopped = t >= 2.2;
  return (
    <Frame kicker="8 of 8 · The gate, in every tool" caps={caps}>
      <div style={{ display: "flex", gap: 40 }}>
        <div style={{ flex: "0 0 820px" }}>
          <Label>Before every tool call</Label>
          <div style={{ position: "relative", height: 330, marginTop: 14 }}>
            <div style={{ position: "absolute", left: 250, top: 148, width: 380, height: 4, background: C.line }} />
            <Reveal at={0.2} dy={0} style={{ position: "absolute", left: 0, top: 108 }}>
              <Card style={{ padding: "14px 22px", width: 230 }}><div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>Agent</div><Mono size={18} color={C.graphite}>asks to run a tool</Mono></Card>
            </Reveal>
            <Reveal at={0.4} dy={0} style={{ position: "absolute", left: 330, top: 80 }}>
              <div style={{ background: C.ink, color: "#fff", borderRadius: 16, padding: "20px 28px", width: 190, textAlign: "center", boxShadow: stopped && t < 2.7 ? `0 0 0 ${10 * (1 - (t - 2.2) / 0.5)}px rgba(194,65,12,0.35)` : undefined }}>
                <Label color="#9ca3af" style={{ fontSize: 16 }}>desk gate</Label>
                <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>Permit?</div>
                <Mono size={16} color="#9ca3af">fails closed</Mono>
              </div>
            </Reveal>
            <div style={{ position: "absolute", left: 258 + 60 * prog(t, 0.8, 1.3), top: 139 + 112 * prog(t, 2.3, 0.45), width: 22, height: 22, borderRadius: 11, background: stopped ? C.redline : C.ink, opacity: lin(t, 0.8, 0.2) * (1 - prog(t, 2.9, 0.3)) }} />
            <Reveal at={2.4} dy={10} dur={0.5} style={{ position: "absolute", left: 330, top: 250 }}>
              <div style={{ border: `2px solid ${C.redline}`, background: C.redSoft, borderRadius: 12, padding: "10px 18px", width: 190 }}>
                <Mono size={20} color={C.redline} style={{ fontWeight: 500 }}>blocked</Mono>
                <div style={{ fontSize: 19, color: C.graphite }}>no permit matches</div>
              </div>
            </Reveal>
            <div style={{ position: "absolute", zIndex: 3, left: 258 + 372 * prog(t, 3.4, 1.4), top: 139, width: 22, height: 22, borderRadius: 11, background: C.cipher, opacity: lin(t, 3.4, 0.2) * (1 - prog(t, 5.0, 0.3)) }} />
            <Reveal at={4.7} dx={20} dy={0} style={{ position: "absolute", left: 640, top: 112 }}>
              <div style={{ border: `2px solid ${C.cipher}`, background: C.cipherSoft, borderRadius: 12, padding: "12px 20px" }}>
                <Mono size={22} color={C.cipher} style={{ fontWeight: 500 }}>ran</Mono>
                <div style={{ fontSize: 19, color: C.graphite }}>a permit covered it</div>
              </div>
            </Reveal>
          </div>
          <Reveal at={cs[2] + 0.2}>
            <Card style={{ padding: "18px 24px", marginTop: 10, borderColor: C.cipher }}>
              <Label color={C.cipher}>For a tool with no hook: the gateway door</Label>
              <div style={{ display: "flex", gap: 36, marginTop: 10, alignItems: "baseline" }}>
                <div><div style={{ fontSize: 56, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1 }}><Count to={product.gateway.refusedMs} at={cs[2] + 0.3} dur={0.9} /> ms</div><div style={{ fontSize: 21, color: C.graphite }}>an over-cap call refused, model never called</div></div>
                <div><div style={{ fontSize: 56, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1 }}><Count to={product.gateway.settledMicro} at={cs[2] + 0.5} dur={0.9} />{" µ$"}</div><div style={{ fontSize: 21, color: C.graphite }}>an allowed call, settled to the micro-dollar</div></div>
              </div>
            </Card>
          </Reveal>
        </div>
        <div style={{ flex: 1 }}>
          <Label>What it can actually stop, tool by tool</Label>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {rows.map((r, i) => {
              const at = cs[1] + 0.2 + i * 0.28;
              return (
                <Reveal key={r.tool} at={at} dx={26} dy={0} dur={0.5}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: `2px solid ${r.level === "enforced" ? C.cipher : C.line}`, background: r.level === "enforced" ? C.cipherSoft : C.paper, borderRadius: 12, padding: "8px 18px" }}>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{r.tool}</div>
                      <Mono size={16} color={C.graphite}>{r.version ? `run live on ${r.version}` : r.level === "advisory" ? "not run live" : "no hook, no gateway"}</Mono>
                    </div>
                    <Pill tone={levelTone(r.level)} filled={r.level === "enforced"}>{r.level}</Pill>
                  </div>
                </Reveal>
              );
            })}
          </div>
          <Reveal at={cs[1] + 2.6}><div style={{ marginTop: 12, fontSize: 21, color: C.graphite, lineHeight: 1.3 }}>A tool counts as enforced only after a recorded test refused a call. {live.length} of {rows.length} have one.</div></Reveal>
        </div>
      </div>
    </Frame>
  );
};


// Nemotron, through Nightshift, signed --------------------------------------------------------------------------------
const ROLE = { ask_planner: "Planner", explainer: "Explainer", policy_drafter: "Drafter", policy_attacker: "Attacker" } as Record<string, string>;
const modelName = (m: string) => (/ultra/.test(m) ? "Nemotron 3 Ultra 550B" : /lightning/.test(m) ? "Nemotron 3.5 Lightning 30B" : m.replace(/^nvidia\//, ""));

const Receipts: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const r = product.receipts;
  const rows = [...r.roles].sort((a, b) => (ROLE[a.role] ?? a.role).localeCompare(ROLE[b.role] ?? b.role) || a.model.localeCompare(b.model));
  const verified = Math.min(r.valid, Math.round(lin(t, cs[1] + 0.2, 2.6) * r.valid));
  return (
    <Frame kicker="Nemotron, through Meterless Nightshift · a signed receipt for every reply" caps={caps}>
      <div style={{ display: "flex", gap: 44 }}>
        <div style={{ flex: "0 0 1020px" }}>
          <Label>Which model answered which role</Label>
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {rows.map((x, i) => {
              const at = 0.6 + i * 0.35;
              const stamp = cs[1] + 0.4 + i * 0.28;
              return (
                <Reveal key={`${x.role}-${x.model}`} at={at} dx={-24} dy={0} dur={0.5}>
                  <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 110px 250px", alignItems: "center", gap: 14, border: `2px solid ${C.line}`, borderRadius: 12, padding: "10px 18px" }}>
                    <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em" }}>{ROLE[x.role] ?? x.role}</div>
                    <Mono size={22} color={/ultra/.test(x.model) ? C.ink : C.graphite}>{modelName(x.model)}</Mono>
                    <Mono size={22} color={C.graphite} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{x.n} {x.n === 1 ? "call" : "calls"}</Mono>
                    <div style={{ justifySelf: "end", opacity: prog(t, stamp, 0.3), transform: `scale(${0.8 + 0.2 * prog(t, stamp, 0.4)})` }}><Pill tone="good" filled size={18}>{"✓ signature valid"}</Pill></div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Reveal at={cs[1]}>
            <Label>Signatures that hold</Label>
            <div style={{ fontSize: 150, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1, color: C.cipher }}>{verified}<span style={{ fontSize: 56, color: C.graphite, letterSpacing: "-0.03em" }}> of {r.total}</span></div>
            <Mono size={20} color={C.graphite}>Ed25519, signed by key {r.keyId}</Mono>
          </Reveal>
          <Reveal at={cs[2] + 0.2}>
            <Card style={{ marginTop: 22, padding: "16px 22px", borderColor: C.redline, background: C.redSoft }}>
              <Label color={C.redline} style={{ fontSize: 17 }}>One number changed in one receipt</Label>
              <div style={{ fontFamily: MONO, fontSize: 26, marginTop: 8 }}>{r.tamper.field} <span style={{ textDecoration: "line-through", color: C.graphite }}>{r.tamper.before}</span> {"→"} {r.tamper.after}</div>
              <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 24, fontWeight: 500, color: C.redline }}>REFUSED: {r.tamper.reason}</div>
            </Card>
            <div style={{ marginTop: 14, fontSize: 22, color: C.graphite, lineHeight: 1.3 }}>The {r.olderUnsigned.toLocaleString("en-US")} receipts recorded before Nightshift signed them are counted as unsigned.</div>
          </Reveal>
        </div>
      </div>
    </Frame>
  );
};

// What is built, and what is not ---------------------------------------------------------------------------------------
const Numbers: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const f = product.features;
  const w = product.tests.windows;
  const u = product.tests.ubuntu;
  const failed = [
    { h: `A swap, withheld`, s: `The larger model reproduced ${product.swap.passPct}% of its own passes; a comparison needs ${product.swap.needPct}%.` },
    { h: `A range short of its label`, s: `Its 90% range held ${Math.round((self.windTunnel.inside / self.windTunnel.n) * 100)}% of ${self.windTunnel.n} months.` },
    { h: `Learning, not claimed`, s: `Moved ${self.learning.to - self.learning.from} of ${self.learning.n} questions on the earlier Desk; the interval touches zero.` },
    { h: `Hooks not run live`, s: `${product.enforcement.filter((e) => e.version === null && /Cursor|Gemini/.test(e.tool)).map((e) => e.tool).join(" and ")}: contract-tested only.` },
  ];
  return (
    <Frame kicker="Built, checked, and what fell short" caps={caps}>
      <div style={{ display: "flex", gap: 36 }}>
        <div style={{ flex: "0 0 1000px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
            <Pop at={0.3}>
              <Card style={{ padding: "24px 30px", minHeight: 236 }}>
                <Label>Specified features built</Label>
                <div style={{ fontSize: 132, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1 }}><Count to={f.built} at={0.5} dur={1.3} /><span style={{ fontSize: 56, color: C.graphite, letterSpacing: "-0.03em" }}> of {f.of}</span></div>
                <div style={{ fontSize: 22, color: C.graphite, marginTop: 6 }}>The one left, {f.absent.join(", ")}, is a log of real Cursor use. Only its user can write it.</div>
              </Card>
            </Pop>
            <Pop at={0.7}>
              <Card style={{ padding: "24px 30px", minHeight: 236 }}>
                <Label>Checks that must pass</Label>
                <div style={{ fontSize: 132, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1, color: C.cipher }}><Count to={product.prove.windows.pass} at={0.9} dur={1.3} /></div>
                <div style={{ fontSize: 22, color: C.graphite, marginTop: 6 }}>desk prove: {product.prove.windows.fail} failed, {product.prove.windows.notRun} not run. A check not run is never counted as a pass.</div>
              </Card>
            </Pop>
            <Pop at={1.1}>
              <Card style={{ padding: "24px 30px", minHeight: 236 }}>
                <Label>Tests, from fresh clones</Label>
                <div style={{ fontSize: 132, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1 }}><Count to={w.of} at={1.3} dur={1.4} /></div>
                <div style={{ fontSize: 22, color: C.graphite, marginTop: 6 }}>{fmt(w.passed)} passed on Windows 11, {fmt(u.passed)} on Ubuntu 22.04; the rest are skipped for a missing tool.</div>
              </Card>
            </Pop>
            <Pop at={1.5}>
              <Card style={{ padding: "24px 30px", minHeight: 236 }}>
                <Label>Pre-registered predictions that held</Label>
                <div style={{ fontSize: 132, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1 }}><Count to={data.bench.predictions} at={1.7} dur={1.0} /><span style={{ fontSize: 56, color: C.graphite, letterSpacing: "-0.03em" }}> of {data.bench.predictions}</span></div>
                <div style={{ fontSize: 22, color: C.graphite, marginTop: 6 }}>Written down before any question of the round was run.</div>
              </Card>
            </Pop>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Reveal at={cs[1] + 0.1}><Label color={C.redline}>What fell short, on screen</Label></Reveal>
          <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
            {failed.map((x, i) => (
              <Reveal key={x.h} at={cs[1] + 0.4 + i * 0.7} dx={30} dy={0}>
                <div style={{ borderLeft: `8px solid ${C.redline}`, paddingLeft: 20 }}>
                  <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>{x.h}</div>
                  <div style={{ fontSize: 22, color: C.graphite, lineHeight: 1.3 }}>{x.s}</div>
                </div>
              </Reveal>
            ))}
          </div>
          <div style={{ marginTop: 18, height: 6, background: C.line, borderRadius: 3 }}><div style={{ height: 6, width: `${lin(t, cs[1], 5) * 100}%`, background: C.redline, borderRadius: 3 }} /></div>
        </div>
      </div>
    </Frame>
  );
};

export const scenesD: Record<"ui" | "gate" | "numbers" | "receipts", SceneDef> = {
  receipts: {
    id: "receipts", kicker: "", Comp: Receipts, min: 12,
    caps: [
      "Nemotron runs through Meterless Nightshift; every reply carries a signed receipt naming the model.",
      `desk. checks the signature: ${product.receipts.total} live calls, four roles, two Nemotron models, all valid.`,
      "Change one number and it is refused; older recordings are counted as unsigned.",
    ],
  },
  ui: {
    id: "ui", kicker: "", Comp: UiTour, min: 0.3 + SCREENS.length * SHOT + 0.9,
    caps: [
      "The same product as fourteen screens on a local, read-only server, every one a capture of the real UI.",
    ],
  },
  gate: {
    id: "gate", kicker: "", Comp: Gate, min: 14,
    caps: [
      "A hook asks the gate before every tool call; no matching permit means no.",
      `Run live, Claude Code and Codex CLI were each stopped. Cursor and Gemini CLI: contract-tested only, advisory.`,
      `No hook? The gateway door refused an over-cap call in ${product.gateway.refusedMs} ms; the model was never called.`,
    ],
  },
  numbers: {
    id: "numbers", kicker: "", Comp: Numbers, min: 12,
    caps: [
      `${product.features.built} of ${product.features.of} specified features are built; ${product.prove.windows.pass} checks pass on fresh Windows and Ubuntu clones.`,
      "It also keeps what fell short on screen: a withheld swap, a range under its label, no learning claimed.",
    ],
  },
};
