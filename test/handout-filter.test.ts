import { describe, it, expect } from "vitest";
import { stripHtml, searchTier, filterViews, groupViewsByKind, aggregateFooter, collectTags } from "../src/handout/handout-filter";
import type { HandoutView } from "../src/handout/handout-view";

function mk(over: Partial<HandoutView>): HandoutView {
  return {
    id: "id",
    name: "",
    kind: "pc",
    typeLabel: "PC",
    ownerName: "",
    tags: [],
    surfaceChip: { area: "surface", state: "all", label: "전원", tone: "green" },
    secretChip: { area: "secret", state: "owner", label: "비공개", tone: "slate" },
    surfaceContent: "",
    secretContent: null,
    secretLocked: false,
    secretRevealed: false,
    canManage: true,
    ...over,
  };
}

describe("stripHtml", () => {
  it("removes tags", () => {
    expect(stripHtml("<p>비밀<b>단서</b></p>")).toContain("비밀");
    expect(stripHtml("<p>x</p>")).not.toContain("<");
  });
});

describe("searchTier", () => {
  it("empty query → 1 (all pass)", () => {
    expect(searchTier(mk({ name: "길동" }), "")).toBe(1);
  });
  it("name match → 1", () => {
    expect(searchTier(mk({ name: "마을 지도" }), "마을")).toBe(1);
  });
  it("owner match → 1", () => {
    expect(searchTier(mk({ name: "x", ownerName: "길동" }), "길동")).toBe(1);
  });
  it("content-only match → 2", () => {
    expect(searchTier(mk({ name: "x", ownerName: "y", surfaceContent: "<p>오래된 단서</p>" }), "단서")).toBe(2);
  });
  it("no match → 0", () => {
    expect(searchTier(mk({ name: "x", ownerName: "y", surfaceContent: "z" }), "없는말")).toBe(0);
  });
  it("locked secret (null) not matched", () => {
    expect(searchTier(mk({ name: "x", ownerName: "y", secretContent: null }), "비밀내용")).toBe(0);
  });
  it("case/space-insensitive", () => {
    expect(searchTier(mk({ name: "Town Map" }), "townmap")).toBe(1);
  });
});

describe("filterViews", () => {
  it("ranks name/owner matches above content-only matches, stable within tier", () => {
    const a = mk({ id: "a", name: "x", surfaceContent: "<p>단서</p>" }); // tier 2
    const b = mk({ id: "b", name: "단서 노트" });                         // tier 1
    const c = mk({ id: "c", name: "y", surfaceContent: "단서 가득" });    // tier 2
    const out = filterViews([a, b, c], { query: "단서", tag: "" });
    expect(out.map((v) => v.id)).toEqual(["b", "a", "c"]);
  });
  it("filters by single category tag", () => {
    const a = mk({ id: "a", tags: [{ cat: "main", label: "메인" }] });
    const b = mk({ id: "b", tags: [{ cat: "sub", label: "서브" }] });
    const out = filterViews([a, b], { query: "", tag: "main" });
    expect(out.map((v) => v.id)).toEqual(["a"]);
  });
  it("combines query and tag", () => {
    const a = mk({ id: "a", name: "지도", tags: [{ cat: "main", label: "메인" }] });
    const b = mk({ id: "b", name: "지도", tags: [{ cat: "sub", label: "서브" }] });
    const out = filterViews([a, b], { query: "지도", tag: "main" });
    expect(out.map((v) => v.id)).toEqual(["a"]);
  });
  it("empty query keeps original order", () => {
    const a = mk({ id: "a" });
    const b = mk({ id: "b" });
    expect(filterViews([a, b], { query: "", tag: "" }).map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("groupViewsByKind", () => {
  it("groups pc then floating, omits empty", () => {
    const a = mk({ id: "a", kind: "pc" });
    const b = mk({ id: "b", kind: "floating" });
    const c = mk({ id: "c", kind: "pc" });
    const g = groupViewsByKind([b, a, c]);
    expect(g.map((x) => x.kind)).toEqual(["pc", "floating"]);
    expect(g[0].label).toBe("PC 핸드아웃");
    expect(g[0].rows.map((v) => v.id)).toEqual(["a", "c"]);
    expect(g[1].rows.map((v) => v.id)).toEqual(["b"]);
  });
  it("omits a kind with no rows", () => {
    const g = groupViewsByKind([mk({ kind: "pc" })]);
    expect(g.map((x) => x.kind)).toEqual(["pc"]);
  });
});

describe("aggregateFooter", () => {
  it("counts total, pc, floating", () => {
    const a = mk({ kind: "pc" });
    const b = mk({ kind: "floating" });
    const c = mk({ kind: "pc" });
    const agg = aggregateFooter([a, b, c]);
    expect(agg.total).toBe(3);
    expect(agg.pc).toBe(2);
    expect(agg.floating).toBe(1);
  });
  it("pending counts only secretRevealed === false", () => {
    const a = mk({ secretRevealed: false });
    const b = mk({ secretRevealed: true });
    const c = mk({ secretRevealed: false });
    expect(aggregateFooter([a, b, c]).pending).toBe(2);
  });
  it("empty array → all zero", () => {
    expect(aggregateFooter([])).toEqual({ total: 0, pc: 0, floating: 0, pending: 0 });
  });
});

describe("collectTags", () => {
  it("여러 view 의 태그 합집합 + 중복 제거", () => {
    const a = mk({ tags: [{ cat: "메인", label: "메인" }, { cat: "장소", label: "장소" }] });
    const b = mk({ tags: [{ cat: "장소", label: "장소" }, { cat: "단서", label: "단서" }] });
    expect(collectTags([a, b])).toEqual(["단서", "메인", "장소"]);
  });
  it("localeCompare 정렬", () => {
    const a = mk({ tags: [{ cat: "b", label: "b" }, { cat: "a", label: "a" }, { cat: "c", label: "c" }] });
    expect(collectTags([a])).toEqual(["a", "b", "c"]);
  });
  it("빈 입력 → 빈 배열", () => {
    expect(collectTags([])).toEqual([]);
  });
  it("태그 없는 view → 빈 배열", () => {
    expect(collectTags([mk({ tags: [] })])).toEqual([]);
  });
});
