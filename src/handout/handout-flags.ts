import { FLAG_SCOPE } from "../constants";
import type { Owner, RevealState } from "./reveal-state";

export type HandoutKind = "pc" | "floating";

export interface HandoutFlags {
  owner: Owner;
  kind: HandoutKind;
  tags: string[];
  revealState: RevealState;
}

export interface CategoryDef {
  label: string;
  tone: string;
}
export type CategoryDict = Record<string, CategoryDef>;

/**
 * createHandout 기본 공개상태(spec §3-3).
 * 표면은 hidden(GM·소유자만)으로 시작한다 — 생성 즉시 전원 공개되는 사고를 막기 위함.
 * GM 이 명시적으로 limited/all 로 전환해야 다른 PC 에게 노출된다.
 */
export const DEFAULT_REVEAL_STATE: RevealState = {
  surface: { mode: "hidden", revealedTo: [] },
  secret: { mode: "owner", revealedTo: [] },
};

export function defaultFlags(owner: Owner, kind: HandoutKind, tags: string[] = []): HandoutFlags {
  return {
    owner,
    kind,
    tags,
    revealState: {
      surface: { ...DEFAULT_REVEAL_STATE.surface, revealedTo: [] },
      secret: { ...DEFAULT_REVEAL_STATE.secret, revealedTo: [] },
    },
  };
}

/** flag 보유 = 핸드아웃 식별(진실의 원천). 없으면 null. */
export function readHandoutFlags(entry: JournalEntry): HandoutFlags | null {
  const owner = entry.getFlag(FLAG_SCOPE, "owner");
  if (owner === undefined) return null;
  return {
    owner: owner as Owner,
    kind: entry.getFlag(FLAG_SCOPE, "kind") as HandoutKind,
    tags: (entry.getFlag(FLAG_SCOPE, "tags") as string[] | undefined) ?? [],
    revealState: entry.getFlag(FLAG_SCOPE, "revealState") as RevealState,
  };
}

export function isHandout(entry: JournalEntry): boolean {
  return entry.getFlag(FLAG_SCOPE, "owner") !== undefined;
}
