import { describe, it, expect } from "vitest";
import { parseTags } from "../src/handout/handout-create";

describe("parseTags", () => {
  it("쉼표 분리 + trim", () => {
    expect(parseTags(" yokai, , main ,clue")).toEqual(["yokai", "main", "clue"]);
  });
  it("빈 항목 제거(연속 쉼표/후행 쉼표)", () => {
    expect(parseTags("a,,b,")).toEqual(["a", "b"]);
  });
  it("중복 제거(순서 보존)", () => {
    expect(parseTags("x,y,x")).toEqual(["x", "y"]);
  });
  it("빈 입력 → 빈 배열", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("   ")).toEqual([]);
  });
});
