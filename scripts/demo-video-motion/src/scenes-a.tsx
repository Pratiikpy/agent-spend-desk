import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import data from "./data.json";
import { C, Card, Count, Frame, Label, MONO, Mono, Redaction, Reveal, SANS, capStarts, lin, prog, useSec, usd } from "./kit";

export type SceneDef = { id: string; kicker: string; caps: string[]; min?: number; Comp: React.FC<{ caps: string[] }> };

const { autopsy, zetaris, canary, propose } = data;
const sub = autopsy.shares[0];
const pct = (n: number) => `${n}%`;
const minus = (n: number) => (n < 0 ? "−" + Math.abs(n).toFixed(1) : "+" + n.toFixed(1));

// 0. The hook ---------------------------------------------------------------------------------------------------------
const Hook: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  return (
    <Frame kicker="The problem · a constructed scenario" caps={caps}>
      <div style={{ paddingTop: 30 }}>
        <Reveal at={0.2}><div style={{ fontSize: 132, lineHeight: 1.0, letterSpacing: "-0.05em", fontWeight: 600 }}>{autopsy.hours} hours in,</div></Reveal>
        <Reveal at={0.9}>
          <div style={{ fontSize: 132, lineHeight: 1.05, letterSpacing: "-0.05em", fontWeight: 600 }}>
            the <Redaction at={2.3}>limit</Redaction> appears.
          </div>
        </Reveal>
        <Reveal at={3.2}>
          <div style={{ marginTop: 40, fontSize: 56, letterSpacing: "-0.03em", color: C.graphite }}>You do not know where it went.</div>
        </Reveal>
        <div style={{ display: "flex", gap: 24, marginTop: 56, opacity: prog(t, 5.2, 0.8) }}>
          <Card style={{ padding: "22px 34px" }}><Label>Estimated at list price</Label><div style={{ fontSize: 76, fontWeight: 600, letterSpacing: "-0.04em" }}><Count to={autopsy.cost} at={5.2} digits={2} prefix="$" /></div></Card>
          <Card style={{ padding: "22px 34px" }}><Label>Priced calls</Label><div style={{ fontSize: 76, fontWeight: 600, letterSpacing: "-0.04em" }}><Count to={autopsy.calls} at={5.4} /></div></Card>
          <Card style={{ padding: "22px 34px" }}><Label>Burn per hour</Label><div style={{ fontSize: 76, fontWeight: 600, letterSpacing: "-0.04em" }}><Count to={autopsy.burn} at={5.6} digits={2} prefix="$" /></div></Card>
        </div>
      </div>
    </Frame>
  );
};

// 1. The product ------------------------------------------------------------------------------------------------------
const Title: React.FC<{ caps: string[] }> = ({ caps }) => {
  const verbs = ["explains the limit", "checks the agent every day", "tests a spend policy on a month it never saw", "signs what it concludes"];
  return (
    <Frame kicker="The product · Track 3, Reasoning Architecture" caps={caps}>
      <Reveal at={0.1}><div style={{ fontSize: 220, lineHeight: 0.9, letterSpacing: "-0.07em", fontWeight: 600 }}>desk<span style={{ color: C.cipher }}>.</span></div></Reveal>
      <Reveal at={0.8}><div style={{ marginTop: 26, fontSize: 52, letterSpacing: "-0.03em", maxWidth: 1060 }}>A local desk for the person who pays for AI coding agents.</div></Reveal>
      <div style={{ position: "absolute", right: 0, top: 40, width: 560, display: "grid", gap: 14 }}>
        {[["Zetaris", "the data layer"], ["Meterless", "memory and history"], ["NVIDIA Nemotron", "every language role"], ["Cursor", "the required IDE"]].map(([h, s], i) => (
          <Reveal key={h} at={2.4 + i * 0.5} dx={30} dy={0}>
            <Card style={{ padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em" }}>{h}</span><Mono size={20} color={C.graphite}>{s}</Mono></Card>
          </Reveal>
        ))}
      </div>
      <div style={{ marginTop: 44, display: "grid", gap: 14 }}>
        {verbs.map((v, i) => (
          <Reveal key={v} at={1.4 + i * 0.5} dx={-30} dy={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 40, letterSpacing: "-0.02em" }}>
              <span style={{ width: 54, height: 8, background: C.cipher, borderRadius: 4 }} />
              <span>It {v}.</span>
            </div>
          </Reveal>
        ))}
      </div>
    </Frame>
  );
};

// 2. The autopsy ------------------------------------------------------------------------------------------------------
const Autopsy: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const shares = autopsy.shares.filter((s) => s.pct > 0);
  const totalPct = shares.reduce((a, s) => a + s.pct, 0);
  const shade = (i: number) => (i === 0 ? C.cipher : ["#0a0a0a", "#374151", "#6b7280", "#9ca3af", "#d1d5db", "#e5e7eb"][Math.min(i - 1, 5)]);
  const growth = prog(t, 0.6, 1.6);
  let acc = 0;
  const firstClause = (s: string) => s.split(/, | and /)[0].replace(/\.$/, "");
  return (
    <Frame kicker="1 of 8 · Where did my limit go?" caps={caps}>
      <div style={{ display: "flex", gap: 56 }}>
        <div style={{ flex: "0 0 980px" }}>
          <Label>One heavy window, split by cause</Label>
          <div style={{ display: "flex", height: 64, marginTop: 20, borderRadius: 12, overflow: "hidden", width: 980 * growth, background: C.line }}>
            {shares.map((s, i) => { const w = (s.pct / totalPct) * 100; acc += w; return <div key={s.label} style={{ width: `${w}%`, background: shade(i), borderRight: "2px solid #fff" }} />; })}
          </div>
          <div style={{ marginTop: 30, display: "grid", gap: 14 }}>
            {shares.map((s, i) => (
              <Reveal key={s.label} at={1.4 + i * 0.28} dy={12} dur={0.5}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 18, fontSize: 31, color: i === 0 ? C.ink : "#374151", fontWeight: i === 0 ? 600 : 400 }}>
                  <span style={{ width: 20, height: 20, background: shade(i), borderRadius: 4, flex: "none", alignSelf: "center" }} />
                  <Mono size={28} style={{ width: 90, textAlign: "right" }}>{pct(s.pct)}</Mono>
                  <Mono size={28} style={{ width: 130, textAlign: "right" }}>{usd(s.usd)}</Mono>
                  <span>{s.label}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <Label>Fixes, ranked by what the cause cost</Label>
          <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
            {autopsy.fixes.map((f, i) => (
              <Reveal key={i} at={cs[1] + 0.3 + i * 1.3}>
                <Card style={{ padding: "18px 26px", borderColor: i === 0 ? C.cipher : C.line }}>
                  <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>{i + 1}. {firstClause(f.text)}</div>
                  <Mono size={20} color={C.graphite}>{f.range.replace(/ \(.*\)$/, "")}</Mono>
                </Card>
              </Reveal>
            ))}
          </div>
          <Reveal at={cs[2] + 0.2}>
            <div style={{ marginTop: 22, background: C.ink, color: "#fff", borderRadius: 14, padding: "18px 26px" }}>
              <Label color="#9ca3af">What it could not know</Label>
              <div style={{ fontSize: 26, marginTop: 8, lineHeight: 1.3 }}>{autopsy.couldNotKnow[0].replace(/ It is not an invoice.*/, "")}</div>
            </div>
          </Reveal>
        </div>
      </div>
    </Frame>
  );
};

// 3. Zetaris ----------------------------------------------------------------------------------------------------------
const Silos: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const silos = [
    { k: "Files", h: "Invoices", s: "a bucket" },
    { k: "Postgres", h: "CI facts", s: "pull requests and checks" },
    { k: "REST", h: "Roster", s: "teams and seats" },
  ];
  const draw = lin(t, cs[1], 1.6);
  return (
    <Frame kicker="2 of 8 · The bill, through Zetaris" caps={caps}>
      <div style={{ position: "relative", height: 720 }}>
        <svg width={1728} height={460} style={{ position: "absolute", left: 0, top: 0 }}>
          {silos.map((_, i) => {
            const y = 80 + i * 150;
            const len = 560;
            return <path key={i} d={`M 410 ${y} C 560 ${y}, 560 230, 700 230`} fill="none" stroke={C.cipher} strokeWidth={4} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />;
          })}
          <path d="M 940 230 L 1010 230" stroke={C.cipher} strokeWidth={4} strokeDasharray={70} strokeDashoffset={70 * (1 - lin(t, cs[1] + 1.5, 0.6))} />
        </svg>
        {silos.map((s, i) => (
          <Reveal key={s.h} at={0.2 + i * 0.35} dx={-30} dy={0} style={{ position: "absolute", left: 0, top: i * 150, width: 410 }}>
            <Card style={{ padding: "16px 26px" }}><Label>{s.k}</Label><div style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.03em" }}>{s.h}</div><div style={{ fontSize: 22, color: C.graphite }}>{s.s}</div></Card>
          </Reveal>
        ))}
        <Reveal at={cs[1] + 0.8} style={{ position: "absolute", left: 700, top: 175, width: 240 }}>
          <div style={{ background: C.ink, color: "#fff", borderRadius: 14, padding: "18px 22px", textAlign: "center" }}>
            <Label color="#9ca3af">One statement</Label>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>Zetaris</div>
          </div>
        </Reveal>
        <Reveal at={cs[1] + 2.0} dx={30} dy={0} style={{ position: "absolute", left: 1010, top: 60, width: 718 }}>
          <Card style={{ padding: "22px 28px" }}>
            <Label>Spend per landed pull request</Label>
            {zetaris.teams.map((r, i) => (
              <Reveal key={r.team} at={cs[1] + 2.6 + i * 0.5} dy={10} dur={0.5}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 32, padding: "12px 0", borderTop: i ? `1px solid ${C.line}` : "none", marginTop: i ? 0 : 10 }}>
                  <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{r.team}</span>
                  <Mono size={22} color={C.graphite}>{r.prs} PRs · {usd(r.billed, 0)}</Mono>
                  <Mono size={30} color={C.cipher} style={{ fontWeight: 500 }}>{usd(r.per)}</Mono>
                </div>
              </Reveal>
            ))}
          </Card>
        </Reveal>
        <div style={{ position: "absolute", left: 0, top: 480, width: 1728, display: "flex", gap: 28 }}>
          <Reveal at={cs[1] + 3.6} style={{ flex: 1 }}>
            <Card style={{ borderColor: C.cipher, background: C.cipherSoft }}>
              <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1 }}><Count to={zetaris.invoiceBelowPct} at={cs[1] + 3.6} digits={1} suffix="%" /></div>
              <div style={{ fontSize: 28, marginTop: 8 }}>Invoices land below my list-price estimate of {usd(zetaris.listEstimate, 0)}. Billed: {usd(zetaris.billed, 0)}.</div>
            </Card>
          </Reveal>
          <Reveal at={cs[2] + 0.3} style={{ flex: 1 }}>
            <Card style={{ borderColor: C.redline }}>
              <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1, color: C.redline }}><Count to={zetaris.mergedRed} at={cs[2] + 0.3} /> of {zetaris.landed}</div>
              <div style={{ fontSize: 28, marginTop: 8 }}>landed sessions merged although the checks were red.</div>
            </Card>
          </Reveal>
        </div>
      </div>
    </Frame>
  );
};

// 4. The canary -------------------------------------------------------------------------------------------------------
const Canary: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const zoom = 1 + 0.025 * lin(t, 0, 14);
  return (
    <Frame kicker={`3 of 8 · The canary · day ${canary.day}`} caps={caps}>
      <div style={{ display: "flex", gap: 56, alignItems: "center" }}>
        <Reveal at={0.2} style={{ flex: "0 0 940px" }}>
          <div style={{ border: `2px solid ${C.line}`, borderRadius: 18, overflow: "hidden", background: "#fff", padding: 14 }}>
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}>
              <Img src={staticFile("img/canary-chart.png")} style={{ width: 910, display: "block" }} />
            </div>
          </div>
          <div style={{ marginTop: 14, fontSize: 22, color: C.graphite }}>The product's Canary screen. The primary arm's model was switched on day {canary.switchDay}, on purpose.</div>
        </Reveal>
        <div style={{ flex: 1 }}>
          <Reveal at={3.0}>
            <Label>Change against the baseline</Label>
            <div style={{ fontSize: 150, fontWeight: 600, letterSpacing: "-0.06em", lineHeight: 1, color: C.redline }}>{"−"}<Count to={Math.abs(canary.change)} at={3.0} digits={1} /></div>
            <Mono size={26} color={C.graphite}>points · 99% interval {minus(canary.lo)} to {minus(canary.hi)}</Mono>
          </Reveal>
          <Reveal at={cs[1] + 0.2}>
            <Card style={{ marginTop: 28, padding: "20px 26px" }}>
              <Label>Control arm</Label>
              <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em", color: C.cipher }}>flat {minus(canary.control.change)} points</div>
              <Mono size={20} color={C.graphite}>95% interval {minus(canary.control.lo)} to {minus(canary.control.hi)}</Mono>
            </Card>
          </Reveal>
          <Reveal at={cs[1] + 2.0}>
            <div style={{ marginTop: 22, display: "flex", gap: 22, alignItems: "baseline", fontSize: 34, letterSpacing: "-0.02em" }}>
              <span>Primary pass rate</span>
              <Mono size={34}>{canary.primary.base}% {"→"} {canary.primary.before}% {"→"} {canary.primary.latest}%</Mono>
            </div>
            <div style={{ marginTop: 12, fontSize: 26, color: C.graphite }}>Consistent with a model switch. Never claimed as the cause.</div>
          </Reveal>
        </div>
      </div>
    </Frame>
  );
};

// 5. Propose ----------------------------------------------------------------------------------------------------------
const Propose: React.FC<{ caps: string[] }> = ({ caps }) => {
  const t = useSec();
  const cs = capStarts(caps);
  const nodeAt = [0.3, 3.2, cs[1] + 0.3, cs[1] + 3.2];
  const nodes = [
    { k: "Nemotron", h: "Drafter", s: `Drafts rules from ${propose.findings.length} findings` },
    { k: "Code", h: "Restrict check", s: `Narrows only, over ${propose.cells} cells` },
    { k: "Nemotron", h: "Attacker", s: `${propose.closed} evasions closed, ${propose.unresolved} unresolved` },
    { k: "Held out", h: "Replay", s: `A month it never saw` },
  ];
  return (
    <Frame kicker="4 of 8 · Propose, check, attack, replay" caps={caps}>
      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        {nodes.map((n, i) => (
          <React.Fragment key={n.h}>
            <Reveal at={nodeAt[i]} dy={18} style={{ flex: 1 }}>
              <Card style={{ padding: "20px 24px", height: "100%", borderColor: i === 3 ? C.ink : C.line }}>
                <Label color={n.k === "Code" ? C.cipher : C.graphite}>{n.k}</Label>
                <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em" }}>{n.h}</div>
                <div style={{ fontSize: 22, color: C.graphite, marginTop: 4 }}>{n.s}</div>
              </Card>
            </Reveal>
            {i < nodes.length - 1 && <div style={{ width: 44, alignSelf: "center", height: 4, background: C.cipher, opacity: prog(t, nodeAt[i + 1] - 0.2, 0.4) }} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 28 }}>
        {propose.findings.map((f, i) => (
          <Reveal key={f.id} at={1.2 + i * 0.5} dy={12} style={{ flex: 1 }}>
            <Card style={{ padding: "12px 20px", background: C.veil }}>
              <Mono size={20} color={C.graphite}>finding {f.id}</Mono>
              <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>{f.runs.toLocaleString("en-US")} runs, {usd(f.usd)} recoverable</div>
            </Card>
          </Reveal>
        ))}
      </div>
      <Reveal at={cs[2]} style={{ marginTop: 30 }}>
        <Label>On the held-out month, {propose.from} to {propose.to}</Label>
        <div style={{ display: "flex", alignItems: "baseline", gap: 36 }}>
          <div style={{ fontSize: 170, fontWeight: 600, letterSpacing: "-0.07em", lineHeight: 1, color: C.redline }}><Count to={propose.blocked} at={cs[2]} /></div>
          <div style={{ fontSize: 52, letterSpacing: "-0.03em", lineHeight: 1.08 }}>of {propose.landed} landed sessions<br />would have been blocked.</div>
        </div>
      </Reveal>
      <Reveal at={cs[2] + 2.2} style={{ display: "flex", gap: 28, marginTop: 24 }}>
        <Card style={{ padding: "16px 26px" }}><Mono size={28}>{propose.paused} sessions paused · {usd(propose.saved)} not spent</Mono><div style={{ fontSize: 20, color: C.graphite }}>an upper bound: it assumes a paused session does nothing more</div></Card>
        <Card style={{ padding: "16px 26px" }}><Mono size={28}>In-sample: {propose.inSample.blocked} of {propose.inSample.landed} blocked</Mono><div style={{ fontSize: 20, color: C.graphite }}>the month it was drafted from</div></Card>
      </Reveal>
    </Frame>
  );
};

export const scenesA: SceneDef[] = [
  {
    id: "hook", kicker: "", Comp: Hook, min: 9,
    caps: [
      `${autopsy.hours} hours in, the limit appears and I do not know why. A constructed scenario; every figure comes from it.`,
    ],
  },
  {
    id: "title", kicker: "", Comp: Title, min: 8,
    caps: [
      `desk. is a local desk for whoever pays for AI coding agents: it explains, checks, tests and signs.`,
    ],
  },
  {
    id: "autopsy", kicker: "", Comp: Autopsy,
    caps: [
      `It splits the heaviest window by cause. Sub-agents are ${pct(sub.pct)} of it.`,
      `It ranks the fixes worth making, each with an interval.`,
      `And it says what it could not know. Unlinked work is unknowable, not waste.`,
    ],
  },
  {
    id: "zetaris", kicker: "", Comp: Silos,
    caps: [
      `The bill is not in the logs: invoices in a bucket, CI in Postgres, a roster behind a service.`,
      `One Zetaris statement joins the three. Invoices land ${zetaris.invoiceBelowPct}% under my list-price estimate.`,
      `And ${zetaris.mergedRed} landed sessions merged although the checks were red.`,
    ],
  },
  {
    id: "canary", kicker: "", Comp: Canary,
    caps: [
      `The canary runs a ${canary.tasks}-task pack daily on each arm; the primary arm's model was switched on day ${canary.switchDay}.`,
      `The call comes with its interval, a flat control arm, and what it cannot say.`,
    ],
  },
  {
    id: "propose", kicker: "", Comp: Propose,
    caps: [
      `Nemotron drafts a cap policy; code checks it only narrows the one in force.`,
      `An Attacker looks for requests that step around it. Then it meets a month it never saw.`,
      `${propose.blocked} of ${propose.landed} landed sessions would have been blocked: the headline, not the savings.`,
    ],
  },
];
