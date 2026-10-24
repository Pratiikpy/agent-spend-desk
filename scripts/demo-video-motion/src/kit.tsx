import React, { useEffect, useState } from "react";
import { AbsoluteFill, Easing, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion";

export const FPS = 30;
export const W = 1920;
export const H = 1080;

// The Blank brand kit: ink on white, one green accent, a rust red kept for what failed or was blocked.
export const C = {
  ink: "#0a0a0a",
  paper: "#ffffff",
  veil: "#f8fafc",
  line: "#e5e7eb",
  graphite: "#6b7280",
  cipher: "#059669",
  cipherSoft: "#e7f6ef",
  redline: "#c2410c",
};
export const SANS = '"Outfit", sans-serif';
export const MONO = '"JetBrains Mono", monospace';

export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const useSec = () => useCurrentFrame() / FPS;
export const prog = (t: number, start: number, dur = 0.7) =>
  interpolate(t, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
export const lin = (t: number, start: number, dur: number) =>
  interpolate(t, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

export const usd = (n: number, digits = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const Fonts: React.FC = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const faces: [string, string, string][] = [
      ["Outfit", "Outfit-Regular.ttf", "400"],
      ["Outfit", "Outfit-SemiBold.ttf", "600"],
      ["JetBrains Mono", "JetBrainsMono-Regular.ttf", "400"],
      ["JetBrains Mono", "JetBrainsMono-Medium.ttf", "500"],
    ];
    Promise.all(
      faces.map(([family, file, weight]) =>
        new FontFace(family, `url(${staticFile(file)})`, { weight }).load().then((f) => (document.fonts as unknown as { add(face: FontFace): void }).add(f)),
      ),
    )
      .then(() => continueRender(handle))
      .catch((e) => cancelRender(e));
  }, [handle]);
  return null;
};

export const Reveal: React.FC<{ at: number; dy?: number; dx?: number; dur?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ at, dy = 26, dx = 0, dur = 0.8, style, children }) => {
  const p = prog(useSec(), at, dur);
  return <div style={{ opacity: p, transform: `translate(${(1 - p) * dx}px, ${(1 - p) * dy}px)`, ...style }}>{children}</div>;
};

export const Count: React.FC<{ to: number; at: number; dur?: number; digits?: number; prefix?: string; suffix?: string }> = ({ to, at, dur = 1.2, digits = 0, prefix = "", suffix = "" }) => {
  const p = prog(useSec(), at, dur);
  return <>{prefix + (to * p).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + suffix}</>;
};

// A black bar that wipes away from left to right, the brand's redaction motif.
export const Redaction: React.FC<{ at: number; dur?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, dur = 0.9, children, style }) => {
  const p = prog(useSec(), at, dur);
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      {children}
      <span style={{ position: "absolute", inset: "0.08em -0.06em 0.04em -0.06em", background: C.ink, transformOrigin: "right center", transform: `scaleX(${1 - p})`, }} />
    </span>
  );
};

export const Label: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color = C.graphite, style }) => (
  <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.14em", textTransform: "uppercase", color, ...style }}>{children}</div>
);

export const Card: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div style={{ border: `2px solid ${C.line}`, borderRadius: 18, background: C.paper, padding: 32, ...style }}>{children}</div>
);

// Reading time for a caption: about 2.7 words a second plus a second, never under 3.4 s.
export const capSeconds = (text: string) => Math.max(3.4, text.trim().split(/\s+/).length / 2.7 + 1.0);
export const capStarts = (caps: string[]) => { let t = 0; return caps.map((c) => { const s = t; t += capSeconds(c); return s; }); };
export const capsTotal = (caps: string[]) => caps.reduce((a, c) => a + capSeconds(c), 0);

export const Caps: React.FC<{ lines: string[] }> = ({ lines }) => {
  const t = useSec();
  let start = 0;
  const starts = lines.map((l) => { const s = start; start += capSeconds(l); return s; });
  let i = 0;
  for (let k = 0; k < lines.length; k++) if (t >= starts[k]) i = k;
  const p = prog(t, starts[i], 0.35);
  return (
    <div style={{ position: "absolute", left: 96, right: 96, bottom: 52, minHeight: 112, display: "flex", alignItems: "center", background: C.ink, color: C.paper, borderRadius: 16, padding: "20px 34px", fontFamily: SANS, fontSize: 36, lineHeight: 1.3, letterSpacing: "-0.01em", opacity: p }}>
      <div style={{ transform: `translateY(${(1 - p) * 10}px)` }}>{lines[i]}</div>
    </div>
  );
};

export const Frame: React.FC<{ kicker: string; caps: string[]; children?: React.ReactNode; tint?: string }> = ({ kicker, caps, children, tint = C.paper }) => {
  const [first, ...rest] = kicker.split(" · ");
  return (
    <AbsoluteFill style={{ background: tint, color: C.ink, fontFamily: SANS }}>
      <div style={{ position: "absolute", left: 96, top: 64 }}>
        <Label color={C.ink} style={{ fontWeight: 500 }}>{first}</Label>
        {rest.length > 0 && <Label style={{ marginTop: 6 }}>{rest.join(" · ")}</Label>}
      </div>
      <div style={{ position: "absolute", right: 96, top: 64 }}>
        <Label style={{ textAlign: "right" }}>desk<span style={{ color: C.cipher }}>.</span></Label>
      </div>
      <div style={{ position: "absolute", left: 96, right: 96, top: 168, bottom: 192, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>
      <Caps lines={caps} />
    </AbsoluteFill>
  );
};

export const Mono: React.FC<{ size?: number; color?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ size = 26, color = C.ink, children, style }) => (
  <span style={{ fontFamily: MONO, fontSize: size, color, ...style }}>{children}</span>
);
