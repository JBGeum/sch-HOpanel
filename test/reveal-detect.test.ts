import { describe, it, expect } from "vitest";
import { buildFingerprint, diffReveals } from "../src/handout/reveal-detect";

const fp = (entries: [string, boolean][]) => new Map(entries);

describe("buildFingerprint", () => {
  it("maps id → secretLocked", () => {
    const m = buildFingerprint([
      { id: "a", secretLocked: false },
      { id: "b", secretLocked: true },
    ]);
    expect(m.get("a")).toBe(false);
    expect(m.get("b")).toBe(true);
    expect(m.size).toBe(2);
  });
});

describe("diffReveals", () => {
  it("new id (surface newly visible) → revealed", () => {
    const prev = fp([["a", false]]);
    const next = fp([["a", false], ["b", true]]);
    expect(diffReveals(prev, next).revealedIds).toEqual(["b"]);
  });
  it("secret unlock (locked true→false) → revealed", () => {
    const prev = fp([["a", true]]);
    const next = fp([["a", false]]);
    expect(diffReveals(prev, next).revealedIds).toEqual(["a"]);
  });
  it("no change → empty", () => {
    const prev = fp([["a", false], ["b", true]]);
    const next = fp([["a", false], ["b", true]]);
    expect(diffReveals(prev, next).revealedIds).toEqual([]);
  });
  it("retract (locked false→true) → not revealed", () => {
    const prev = fp([["a", false]]);
    const next = fp([["a", true]]);
    expect(diffReveals(prev, next).revealedIds).toEqual([]);
  });
  it("disappeared id (in prev, not next) → not revealed", () => {
    const prev = fp([["a", false], ["b", false]]);
    const next = fp([["a", false]]);
    expect(diffReveals(prev, next).revealedIds).toEqual([]);
  });
  it("multiple reveals combined (new id + secret unlock)", () => {
    const prev = fp([["a", true], ["b", false]]);
    const next = fp([["a", false], ["b", false], ["c", false]]);
    expect(diffReveals(prev, next).revealedIds.sort()).toEqual(["a", "c"]);
  });
});
