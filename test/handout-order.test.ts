import { describe, it, expect } from "vitest";
import { sortByOrder } from "../src/handout/handout-order";

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
