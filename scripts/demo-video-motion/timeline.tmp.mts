import { scenes, sceneFrames, TOTAL_FRAMES } from "./src/Video.tsx";
let at = 0;
scenes.forEach((s, i) => { console.log(String(at).padStart(5), (at / 30).toFixed(1).padStart(6) + "s", (sceneFrames[i] / 30).toFixed(1).padStart(5) + "s", s.id); at += sceneFrames[i]; });
console.log("TOTAL", (TOTAL_FRAMES / 30).toFixed(1));
