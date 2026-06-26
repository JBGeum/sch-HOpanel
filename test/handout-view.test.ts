import { describe, it, expect } from "vitest";
import { surfaceChip, secretChip, resolveTags } from "../src/handout/handout-view";

describe("surfaceChip", () => {
  it("all → 전원/green", () => {
    expect(surfaceChip("all", 0)).toEqual({
      area: "surface",
      state: "all",
      label: "전원",
      tone: "green",
    });
  });
  it("limited → 일부 N/amber", () => {
    expect(surfaceChip("limited", 2)).toEqual({
      area: "surface",
      state: "limited",
      label: "일부 2",
      tone: "amber",
    });
  });
  it("hidden → 숨김/rose", () => {
    expect(surfaceChip("hidden", 0).label).toBe("숨김");
    expect(surfaceChip("hidden", 0).tone).toBe("rose");
  });
});

describe("secretChip", () => {
  it("owner → 비공개/slate", () => {
    expect(secretChip("owner", 0)).toEqual({
      area: "secret",
      state: "owner",
      label: "비공개",
      tone: "slate",
    });
  });
  it("limited → 공개 N/blue", () => {
    expect(secretChip("limited", 3)).toEqual({
      area: "secret",
      state: "limited",
      label: "공개 3",
      tone: "blue",
    });
  });
  it("all → 전원공개/violet", () => {
    expect(secretChip("all", 0).label).toBe("전원공개");
    expect(secretChip("all", 0).tone).toBe("violet");
  });
});

describe("resolveTags", () => {
  it("태그 문자열을 cat=label 로 매핑", () => {
    expect(resolveTags(["main", "장소"])).toEqual([
      { cat: "main", label: "main" },
      { cat: "장소", label: "장소" },
    ]);
  });
  it("빈 배열 → 빈 배열", () => {
    expect(resolveTags([])).toEqual([]);
  });
});
