import { describe, it, expect } from "vitest";
import { computeOwnership, OWNERSHIP, type ComputeInput } from "../src/handout/reveal-state";

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
