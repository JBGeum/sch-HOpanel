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
 * revealedTo 중 실제로 존재하는(삭제되지 않은) actorId 만 남긴다(순서 보존).
 * 삭제된 액터의 id 는 flag 에 남아도 실제 접근 권한이 없으므로(resolveActorOwners→[]),
 * 칩 카운트·회수 후보 계산에서 제외해 "여전히 공개됨" 오표시와 회수 불가 고착을 막는다.
 * isLive 는 Foundry 런타임에서 주입한다(game.actors 존재 여부).
 */
export function liveRevealed(revealedTo: string[], isLive: (actorId: string) => boolean): string[] {
  return revealedTo.filter(isLive);
}

/**
 * 비밀 회수 후 다음 secret 상태를 계산한다(순수).
 * - all(전원공개) → owner(비공개)로 전체 회수.
 * - limited → 회수 선택(targets)과 삭제된 액터(!isLive)를 모두 제거. 남은 대상이 없으면 owner 로 강등.
 * - owner → 회수 대상 없음(그대로).
 * 삭제된 actorId 를 항상 함께 제거하므로, 공개 대상이 모두 사라진 고착 상태(빈 회수 선택)도 owner 로 수렴한다.
 */
export function computeRetractSecret(
  prev: RevealState["secret"],
  targets: string[],
  isLive: (actorId: string) => boolean,
): RevealState["secret"] {
  if (prev.mode === "all") return { mode: "owner", revealedTo: [] };
  if (prev.mode !== "limited") return prev; // owner — 회수 대상 없음
  const remaining = liveRevealed(prev.revealedTo, isLive).filter((a) => !targets.includes(a));
  return remaining.length > 0
    ? { mode: "limited", revealedTo: remaining }
    : { mode: "owner", revealedTo: [] };
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

/** Element-wise MAX of two ownership maps (used to derive entry-level ownership
 *  from the surface and secret page maps: a user who can see either can see the entry). */
export function mergeOwnershipMaps(a: OwnershipMap, b: OwnershipMap): OwnershipMap {
  const out: OwnershipMap = { default: Math.max(a.default, b.default) as OwnershipLevel };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "default") continue;
    const av = (a[k] ?? a.default) as OwnershipLevel;
    const bv = (b[k] ?? b.default) as OwnershipLevel;
    out[k] = Math.max(av, bv) as OwnershipLevel;
  }
  return out;
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

  // 앞면
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
