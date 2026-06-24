import { describe, it, expect } from "vitest";
import { parseTags, splitTagsForEdit } from "../src/handout/handout-create";
import type { CategoryDict } from "../src/handout/handout-flags";

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

describe("splitTagsForEdit", () => {
  const dict: CategoryDict = {
    main: { label: "메인", tone: "rose" },
    yokai: { label: "괴이", tone: "violet" },
  };

  it("dict 키와 비-dict 키 분리", () => {
    expect(splitTagsForEdit(["main", "custom1", "yokai", "custom2"], dict)).toEqual({
      selected: ["main", "yokai"],
      free: "custom1, custom2",
    });
  });
  it("빈 tags → 빈 selected + 빈 free", () => {
    expect(splitTagsForEdit([], dict)).toEqual({ selected: [], free: "" });
  });
  it("전부 dict → free 빈 문자열", () => {
    expect(splitTagsForEdit(["main", "yokai"], dict)).toEqual({ selected: ["main", "yokai"], free: "" });
  });
  it("전부 비-dict → selected 빈 배열", () => {
    expect(splitTagsForEdit(["a", "b"], dict)).toEqual({ selected: [], free: "a, b" });
  });
  it("빈 dict → 전부 free", () => {
    expect(splitTagsForEdit(["a", "b"], {})).toEqual({ selected: [], free: "a, b" });
  });
  it("상속 속성('toString')은 dict 키로 오분류하지 않음(hasOwnProperty)", () => {
    expect(splitTagsForEdit(["toString", "main"], dict)).toEqual({ selected: ["main"], free: "toString" });
  });
  it("parseTags 와 라운드트립: 집합 동일 + dict앞/free뒤 정규화", () => {
    const tags = ["main", "custom1", "yokai", "custom2"];
    const { selected, free } = splitTagsForEdit(tags, dict);
    expect(parseTags(selected, free)).toEqual(["main", "yokai", "custom1", "custom2"]);
  });
});
