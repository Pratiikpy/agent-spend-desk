import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const FONT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "assets", "fonts");
const FONTS = ["Outfit-Regular.ttf", "Outfit-SemiBold.ttf", "JetBrainsMono-Regular.ttf", "JetBrainsMono-Medium.ttf"].map((f) => join(FONT_DIR, f));

/** Rasterise an SVG locally with the bundled fonts. No browser, no network, no system fonts, so the output is the same on every machine. */
export function svgToPng(svg: string, scale = 1): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: scale === 1 ? { mode: "original" } : { mode: "zoom", value: scale },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Outfit" },
  });
  return resvg.render().asPng();
}
