import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { C, FPS, Fonts, capsTotal } from "./kit";
import { scenesA, type SceneDef } from "./scenes-a";
import { scenesB } from "./scenes-b";
import { scenesC } from "./scenes-c";

// hook, title, architecture and tracks, the real screens, then the eight beats, the vision and the close
const byId = (list: SceneDef[], id: string) => { const s = list.find((x) => x.id === id); if (!s) throw new Error(`scene ${id} missing`); return s; };
export const scenes: SceneDef[] = [
  byId(scenesA, "hook"), byId(scenesA, "title"), scenesC.architecture, scenesC.ui,
  byId(scenesA, "autopsy"), byId(scenesA, "zetaris"), byId(scenesA, "canary"), byId(scenesA, "propose"),
  byId(scenesB, "ask"), byId(scenesB, "bench"), byId(scenesB, "self"), byId(scenesB, "verify"),
  scenesC.vision, byId(scenesB, "close"),
];

// A scene lasts as long as its captions take to read (plus a pause), or its own minimum if the animation needs more.
export const sceneFrames = scenes.map((s) => Math.ceil(Math.max(s.min ?? 0, capsTotal(s.caps) + 0.8) * FPS));
export const TOTAL_FRAMES = sceneFrames.reduce((a, b) => a + b, 0);

// The submission asks for a video of one to four minutes; fail the build rather than render one outside it.
if (TOTAL_FRAMES / FPS > 238 || TOTAL_FRAMES / FPS < 60) {
  throw new Error(`The video would run ${(TOTAL_FRAMES / FPS).toFixed(1)} s, outside the 60 to 238 s window.`);
}

const Faded: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, frames - 8, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
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
            <Faded frames={sceneFrames[i]}><s.Comp caps={s.caps} /></Faded>
          </Sequence>
        );
      })}
      <Progress />
    </AbsoluteFill>
  );
};
