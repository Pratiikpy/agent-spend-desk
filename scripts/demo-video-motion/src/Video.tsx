import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, FPS, Fonts, capsTotal, ease } from "./kit";
import { scenesA, type SceneDef } from "./scenes-a";
import { scenesB } from "./scenes-b";
import { scenesC } from "./scenes-c";
import { scenesD } from "./scenes-d";

// hook, title, architecture, the real screens, the eight beats (limit, bill, canary, policy, ask, benchmark, offline proof, gate),
// what it measured about itself, what is built, the vision and the close
const byId = (list: SceneDef[], id: string) => { const s = list.find((x) => x.id === id); if (!s) throw new Error(`scene ${id} missing`); return s; };
export const scenes: SceneDef[] = [
  byId(scenesA, "hook"), byId(scenesA, "title"), scenesC.architecture, scenesD.ui,
  byId(scenesA, "autopsy"), byId(scenesA, "zetaris"), byId(scenesA, "canary"), byId(scenesA, "propose"),
  byId(scenesB, "ask"), scenesD.receipts, byId(scenesB, "bench"), scenesD.roles, byId(scenesB, "verify"), scenesD.gate,
  scenesD.numbers, scenesC.vision, byId(scenesB, "close"),
];

// A scene lasts as long as its captions take to read (plus a pause), or its own minimum if the animation needs more.
export const sceneFrames = scenes.map((s) => Math.ceil(Math.max(s.min ?? 0, capsTotal(s.caps) + 0.7) * FPS));
export const TOTAL_FRAMES = sceneFrames.reduce((a, b) => a + b, 0);

// The submission asks for a video of one to four minutes; fail the build rather than render one outside it.
if (TOTAL_FRAMES / FPS > 238 || TOTAL_FRAMES / FPS < 60) {
  throw new Error(`The video would run ${(TOTAL_FRAMES / FPS).toFixed(1)} s, outside the 60 to 238 s window.`);
}

const WIPE = 13;

// The redaction bar as the cut: it closes over the scene that ends and opens off the one that begins.
const Wiped: React.FC<{ frames: number; first: boolean; last: boolean; children: React.ReactNode }> = ({ frames, first, last, children }) => {
  const f = useCurrentFrame();
  const opened = first ? 0 : interpolate(f, [0, WIPE], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const closing = interpolate(f, [frames - WIPE, frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const showClose = last ? 0 : closing;
  return (
    <AbsoluteFill>
      {children}
      <AbsoluteFill style={{ background: C.ink, transformOrigin: "100% 50%", transform: `scaleX(${opened})` }} />
      <AbsoluteFill style={{ background: C.ink, transformOrigin: "0% 50%", transform: `scaleX(${showClose})` }} />
      {/* the bar's leading edge, in the one accent */}
      {showClose > 0.001 && showClose < 0.999 && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${showClose * 100}%`, width: 10, background: C.cipher, transform: "translateX(-10px)" }} />}
    </AbsoluteFill>
  );
};

const Progress: React.FC = () => {
  const f = useCurrentFrame();
  let at = 0;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8, background: C.line }}>
      <div style={{ width: `${(f / TOTAL_FRAMES) * 100}%`, height: 8, background: C.cipher }} />
      {sceneFrames.slice(0, -1).map((n, i) => { at += n; return <div key={i} style={{ position: "absolute", left: `${(at / TOTAL_FRAMES) * 100}%`, top: 0, width: 3, height: 8, background: C.paper }} />; })}
    </div>
  );
};

export const Demo: React.FC = () => {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Fonts />
      {scenes.map((s, i) => {
        const start = from;
        from += sceneFrames[i];
        return (
          <Sequence key={s.id} from={start} durationInFrames={sceneFrames[i]}>
            <Wiped frames={sceneFrames[i]} first={i === 0} last={i === scenes.length - 1}><s.Comp caps={s.caps} /></Wiped>
          </Sequence>
        );
      })}
      <Progress />
    </AbsoluteFill>
  );
};
