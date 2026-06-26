import { describe, it, expect } from "vitest";
import { sortByOrder, computeReorder } from "../src/handout/handout-order";

describe("sortByOrder", () => {
  const get = (x: { id: string; order?: number }): number | undefined => x.order;

  it("orders by numeric order ascending", () => {
    const items = [
      { id: "b", order: 2 },
      { id: "a", order: 1 },
      { id: "c", order: 3 },
    ];
    expect(sortByOrder(items, get).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("places order-less items at the end preserving input order", () => {
    const items = [
      { id: "x" }, // undefined
      { id: "a", order: 1 },
      { id: "y" }, // undefined
      { id: "b", order: 0 },
    ];
    expect(sortByOrder(items, get).map((x) => x.id)).toEqual(["b", "a", "x", "y"]);
  });

  it("is stable for equal orders", () => {
    const items = [
      { id: "a", order: 5 },
      { id: "b", order: 5 },
      { id: "c", order: 5 },
    ];
    expect(sortByOrder(items, get).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const items = [
      { id: "b", order: 2 },
      { id: "a", order: 1 },
    ];
    sortByOrder(items, get);
    expect(items.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("computeReorder", () => {
  it("moves an item before a target (already-ordered)", () => {
    const items = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
      { id: "d", order: 3 },
    ];
    // move d before b -> a, d, b, c
    const updates = computeReorder(items, "d", "b", "before");
    expect(updates).toEqual([
      { id: "d", order: 1 },
      { id: "b", order: 2 },
      { id: "c", order: 3 },
    ]);
  });

  it("moves an item after a target", () => {
    const items = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
    ];
    // move a after b -> b, a, c
    const updates = computeReorder(items, "a", "b", "after");
    expect(updates).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
    ]);
  });

  it("normalizes all when orders are undefined (legacy first drag)", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    // move b after c -> a, c, b, d ; all get fresh integer orders
    const updates = computeReorder(items, "b", "c", "after");
    expect(updates).toEqual([
      { id: "a", order: 0 },
      { id: "c", order: 1 },
      { id: "b", order: 2 },
      { id: "d", order: 3 },
    ]);
  });

  it("returns empty for no-op (moved === target)", () => {
    const items = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
    ];
    expect(computeReorder(items, "a", "a", "before")).toEqual([]);
  });

  it("returns empty for unknown ids", () => {
    const items = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
    ];
    expect(computeReorder(items, "z", "a", "before")).toEqual([]);
    expect(computeReorder(items, "a", "z", "before")).toEqual([]);
  });

  it("preserves other-group relative order when moving one item (group view)", () => {
    // 전역 시퀀스가 kind 를 섞음: pc(a), float(x), pc(b), float(y)
    const items = [
      { id: "a", order: 0 },
      { id: "x", order: 1 },
      { id: "b", order: 2 },
      { id: "y", order: 3 },
    ];
    // PC 그룹에서 b 를 a 앞으로 -> 전역: b, a, x, y
    const updates = computeReorder(items, "b", "a", "before");
    expect(updates).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
      { id: "x", order: 2 },
    ]);
    // y 는 order 3 유지(변경 없음) → updates 미포함. x(2) 가 y(3) 앞 — 상대순서 보존.
  });
});
