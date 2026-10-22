import { describe, expect, it } from "vitest";

import { verifyBundle } from "../../../src/desk/verify/verify.ts";
import { makeFixture } from "./fixture.ts";

describe("a built dossier", () => {
  it("passes every level with the issuer's pin", () => {
    const fx = makeFixture();
    const r = verifyBundle(fx.files, { pins: fx.pins });
    for (const l of r.levels) console.log(l.id, l.status, JSON.stringify(l.findings), l.notes.join("|"));
    expect(r.overall).toBe("PASS");
  });
});
