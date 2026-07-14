import { describe, it, expect } from "vitest";
import {
  computeOwnership,
  computeRetractSecret,
  liveRevealed,
  revealDependsOnActor,
  OWNERSHIP,
  type ComputeInput,
  type Owner,
  type RevealState,
} from "../src/handout/reveal-state";

// actor "A" 는 user u1; actor "B" 는 user u2,u3 (멀티오너)
const resolve = (actorId: string): string[] =>
  ({ A: ["u1"], B: ["u2", "u3"] } as Record<string, string[]>)[actorId] ?? [];

function input(over: Partial<ComputeInput> = {}): ComputeInput {
  return {
    owner: { kind: "actor", actorId: "A" },
    revealState: {
      surface: { mode: "all", revealedTo: [] },
      secret: { mode: "owner", revealedTo: [] },
    },
    resolveActorOwners: resolve,
    ...over,
  };
}

describe("computeOwnership — surface", () => {
  it("all → default OBSERVER, owner OWNER", () => {
    const { surface } = computeOwnership(input());
    expect(surface).toEqual({ default: OWNERSHIP.OBSERVER, u1: OWNERSHIP.OWNER });
  });

  it("limited → default NONE, owner OWNER, revealed OBSERVER", () => {
    const { surface } = computeOwnership(
      input({
        revealState: {
          surface: { mode: "limited", revealedTo: ["B"] },
          secret: { mode: "owner", revealedTo: [] },
        },
      }),
    );
    expect(surface).toEqual({
      default: OWNERSHIP.NONE,
      u1: OWNERSHIP.OWNER,
      u2: OWNERSHIP.OBSERVER,
      u3: OWNERSHIP.OBSERVER,
    });
  });

  it("hidden → default NONE, owner OWNER only", () => {
    const { surface } = computeOwnership(
      input({
        revealState: {
          surface: { mode: "hidden", revealedTo: [] },
          secret: { mode: "owner", revealedTo: [] },
        },
      }),
    );
    expect(surface).toEqual({ default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER });
  });
});

describe("computeOwnership — secret", () => {
  it("owner → default NONE, owner OWNER", () => {
    const { secret } = computeOwnership(input());
    expect(secret).toEqual({ default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER });
  });

  it("limited → revealed OBSERVER added", () => {
    const { secret } = computeOwnership(
      input({
        revealState: {
          surface: { mode: "all", revealedTo: [] },
          secret: { mode: "limited", revealedTo: ["B"] },
        },
      }),
    );
    expect(secret).toEqual({
      default: OWNERSHIP.NONE,
      u1: OWNERSHIP.OWNER,
      u2: OWNERSHIP.OBSERVER,
      u3: OWNERSHIP.OBSERVER,
    });
  });

  it("all → default OBSERVER", () => {
    const { secret } = computeOwnership(
      input({
        revealState: {
          surface: { mode: "all", revealedTo: [] },
          secret: { mode: "all", revealedTo: [] },
        },
      }),
    );
    expect(secret).toEqual({ default: OWNERSHIP.OBSERVER, u1: OWNERSHIP.OWNER });
  });
});

describe("mergeOwnershipMaps", () => {
  // Import is checked at module level — we rely on the named export being present.
  // If the function doesn't exist yet, the import itself will throw and all tests here will error.
  it("PC handout (surface all + secret owner): surface default wins, owner stays OWNER", async () => {
    const { mergeOwnershipMaps } = await import("../src/handout/reveal-state");
    const surface = { default: OWNERSHIP.OBSERVER, u1: OWNERSHIP.OWNER };
    const secret = { default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER };
    expect(mergeOwnershipMaps(surface, secret)).toEqual({ default: OWNERSHIP.OBSERVER, u1: OWNERSHIP.OWNER });
  });

  it("hidden surface + owner secret: entry stays private to owner only", async () => {
    const { mergeOwnershipMaps } = await import("../src/handout/reveal-state");
    const surface = { default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER };
    const secret = { default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER };
    expect(mergeOwnershipMaps(surface, secret)).toEqual({ default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER });
  });

  it("secret revealed to u2: u2 receives OBSERVER on entry", async () => {
    const { mergeOwnershipMaps } = await import("../src/handout/reveal-state");
    const surface = { default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER };
    const secret = { default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER, u2: OWNERSHIP.OBSERVER };
    expect(mergeOwnershipMaps(surface, secret)).toEqual({ default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER, u2: OWNERSHIP.OBSERVER });
  });

  it("OWNER in one map + OBSERVER in other: OWNER wins (max)", async () => {
    const { mergeOwnershipMaps } = await import("../src/handout/reveal-state");
    const surface = { default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER };
    const secret = { default: OWNERSHIP.NONE, u1: OWNERSHIP.OBSERVER };
    expect(mergeOwnershipMaps(surface, secret)).toEqual({ default: OWNERSHIP.NONE, u1: OWNERSHIP.OWNER });
  });
});

// 살아있는 액터: A, B, C. 그 외 id 는 삭제된 것으로 간주.
const live = new Set(["A", "B", "C"]);
const isLive = (id: string): boolean => live.has(id);

describe("liveRevealed", () => {
  it("전부 살아있으면 그대로 유지(순서 보존)", () => {
    expect(liveRevealed(["A", "B"], isLive)).toEqual(["A", "B"]);
  });
  it("삭제된 id 는 제외", () => {
    expect(liveRevealed(["A", "X", "B"], isLive)).toEqual(["A", "B"]);
  });
  it("전부 삭제되면 빈 배열", () => {
    expect(liveRevealed(["X", "Y"], isLive)).toEqual([]);
  });
  it("빈 입력 → 빈 배열", () => {
    expect(liveRevealed([], isLive)).toEqual([]);
  });
});

describe("computeRetractSecret", () => {
  it("all(전원공개) → owner(비공개)로 전체 회수", () => {
    expect(computeRetractSecret({ mode: "all", revealedTo: [] }, [], isLive)).toEqual({
      mode: "owner",
      revealedTo: [],
    });
  });

  it("owner → 회수 대상 없음(그대로)", () => {
    const prev = { mode: "owner", revealedTo: [] } as const;
    expect(computeRetractSecret(prev, ["A"], isLive)).toEqual(prev);
  });

  it("limited: 일부만 회수하면 나머지는 limited 유지", () => {
    expect(
      computeRetractSecret({ mode: "limited", revealedTo: ["A", "B"] }, ["A"], isLive),
    ).toEqual({ mode: "limited", revealedTo: ["B"] });
  });

  it("limited: 살아있는 대상을 전부 회수하면 owner 로 강등", () => {
    expect(
      computeRetractSecret({ mode: "limited", revealedTo: ["A", "B"] }, ["A", "B"], isLive),
    ).toEqual({ mode: "owner", revealedTo: [] });
  });

  it("limited: 삭제된 대상은 회수 선택 없이도 항상 함께 제거", () => {
    // 살아있는 B 는 유지, 삭제된 X 는 자동 제거
    expect(
      computeRetractSecret({ mode: "limited", revealedTo: ["X", "B"] }, [], isLive),
    ).toEqual({ mode: "limited", revealedTo: ["B"] });
  });

  it("limited: 공개 대상이 모두 삭제된 고착 상태 → owner 로 정리(회수 대상 무관)", () => {
    // 신고된 버그의 핵심: revealedTo 가 죽은 id 뿐이면 회수 대상이 비어도 owner 로 수렴
    expect(
      computeRetractSecret({ mode: "limited", revealedTo: ["X", "Y"] }, [], isLive),
    ).toEqual({ mode: "owner", revealedTo: [] });
  });

  it("limited: 살아있는 대상 회수 + 남은 죽은 id → owner(죽은 id 잔존 방지)", () => {
    expect(
      computeRetractSecret({ mode: "limited", revealedTo: ["A", "X"] }, ["A"], isLive),
    ).toEqual({ mode: "owner", revealedTo: [] });
  });
});

describe("computeOwnership — edge cases", () => {
  it("gm owner → secret owner is GM-only ({default: NONE})", () => {
    const { secret } = computeOwnership(input({ owner: { kind: "gm" } }));
    expect(secret).toEqual({ default: OWNERSHIP.NONE });
  });

  it("multi-owner actor → both users OWNER", () => {
    const { secret } = computeOwnership(input({ owner: { kind: "actor", actorId: "B" } }));
    expect(secret).toEqual({ default: OWNERSHIP.NONE, u2: OWNERSHIP.OWNER, u3: OWNERSHIP.OWNER });
  });

  it("OWNER wins when owner is also in revealedTo (secret limited)", () => {
    const { secret } = computeOwnership(
      input({
        owner: { kind: "actor", actorId: "A" },
        revealState: {
          surface: { mode: "all", revealedTo: [] },
          secret: { mode: "limited", revealedTo: ["A"] }, // owner self-revealed
        },
      }),
    );
    expect(secret.u1).toBe(OWNERSHIP.OWNER); // not downgraded to OBSERVER
  });
});

describe("revealDependsOnActor", () => {
  const owner: Owner = { kind: "actor", actorId: "A" };
  const rs: RevealState = {
    surface: { mode: "limited", revealedTo: ["S1"] },
    secret: { mode: "limited", revealedTo: ["C1"] },
  };
  it("owner 액터면 true", () => {
    expect(revealDependsOnActor(owner, rs, "A")).toBe(true);
  });
  it("surface.revealedTo 에 있으면 true", () => {
    expect(revealDependsOnActor(owner, rs, "S1")).toBe(true);
  });
  it("secret.revealedTo 에 있으면 true", () => {
    expect(revealDependsOnActor(owner, rs, "C1")).toBe(true);
  });
  it("어디에도 없으면 false", () => {
    expect(revealDependsOnActor(owner, rs, "Z")).toBe(false);
  });
  it("gm owner(actorId 없음) + 무관 id → false", () => {
    expect(revealDependsOnActor({ kind: "gm" }, rs, "Z")).toBe(false);
  });
});
