/**
 * 권한 계산의 단일 진실 경로. Foundry 런타임 무의존(순수 함수)이라 단위 테스트 가능.
 * 각 page 의 ownership 은 항상 이 함수로 파생한다(직접 편집 금지).
 */

/** Foundry CONST.DOCUMENT_OWNERSHIP_LEVELS 미러(로컬 상수). */
export const OWNERSHIP = { NONE: 0, OBSERVER: 2, OWNER: 3 } as const;

export type OwnershipLevel = 0 | 2 | 3;
export type OwnershipMap = { default: OwnershipLevel } & Record<string, OwnershipLevel>;

export type SurfaceMode = "all" | "limited" | "hidden";
export type SecretMode = "owner" | "limited" | "all";

export interface RevealState {
  surface: { mode: SurfaceMode; revealedTo: string[] };
  secret: { mode: SecretMode; revealedTo: string[] };
}

export interface Owner {
  kind: "actor" | "gm";
  actorId?: string;
}

export interface ComputeInput {
  owner: Owner;
  revealState: RevealState;
  /** actorId → 비-GM OWNER userId[] (Foundry 런타임 주입). */
  resolveActorOwners: (actorId: string) => string[];
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * default + observer + owner 를 합성한 맵. owner 를 마지막에 써서
 * 동일 userId 가 OBSERVER 와 겹쳐도 OWNER 가 우선(상위 권한 유지)되게 한다.
 */
function buildMap(
  defaultLevel: OwnershipLevel,
  owners: string[],
  observers: string[],
): OwnershipMap {
  const map: OwnershipMap = { default: defaultLevel };
  for (const id of observers) map[id] = OWNERSHIP.OBSERVER;
  for (const id of owners) map[id] = OWNERSHIP.OWNER;
  return map;
}

export function computeOwnership(input: ComputeInput): {
  surface: OwnershipMap;
  secret: OwnershipMap;
} {
  const { owner, revealState, resolveActorOwners } = input;

  const ownerUserIds =
    owner.kind === "actor" && owner.actorId ? unique(resolveActorOwners(owner.actorId)) : [];

  const resolveRevealed = (actorIds: string[]): string[] =>
    unique(actorIds.flatMap((id) => resolveActorOwners(id)));

  // 표면
  const s = revealState.surface;
  const surface: OwnershipMap =
    s.mode === "all"
      ? buildMap(OWNERSHIP.OBSERVER, ownerUserIds, [])
      : s.mode === "limited"
        ? buildMap(OWNERSHIP.NONE, ownerUserIds, resolveRevealed(s.revealedTo))
        : buildMap(OWNERSHIP.NONE, ownerUserIds, []); // hidden

  // 비밀
  const c = revealState.secret;
  const secret: OwnershipMap =
    c.mode === "owner"
      ? buildMap(OWNERSHIP.NONE, ownerUserIds, [])
      : c.mode === "limited"
        ? buildMap(OWNERSHIP.NONE, ownerUserIds, resolveRevealed(c.revealedTo))
        : buildMap(OWNERSHIP.OBSERVER, ownerUserIds, []); // all

  return { surface, secret };
}
