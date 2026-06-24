import { describe, it, expect } from "vitest";
import { parseTags } from "../src/handout/handout-create";

describe("parseTags", () => {
  it("사전 선택 + 자유 입력 병합", () => {
    expect(parseTags(["main"], " yokai, , main ,clue")).toEqual(["main", "yokai", "clue"]);
  });
  it("자유 입력 공백 trim", () => {
    expect(parseTags([], " a , b ")).toEqual(["a", "b"]);
  });
  it("빈 항목 제거(연속 쉼표/후행 쉼표)", () => {
    expect(parseTags([], "a,,b,")).toEqual(["a", "b"]);
  });
  it("중복 제거(selected ↔ free 교차)", () => {
    expect(parseTags(["x"], "x,y,x")).toEqual(["x", "y"]);
  });
  it("입력 순서 보존(selected 가 앞)", () => {
    expect(parseTags(["b"], "a")).toEqual(["b", "a"]);
  });
  it("빈 freeText → selected 그대로", () => {
    expect(parseTags(["a"], "")).toEqual(["a"]);
  });
  it("빈 selected → free 만", () => {
    expect(parseTags([], "a")).toEqual(["a"]);
  });
  it("양쪽 빈 → 빈 배열", () => {
    expect(parseTags([], "")).toEqual([]);
  });
});
