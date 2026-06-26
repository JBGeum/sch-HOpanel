/**
 * handout-repo: JournalEntry CRUD, folder management, and ownership derivation.
 * All page ownership is derived exclusively via computeOwnership (single source of truth).
 * No direct ownership map construction anywhere in this file.
 */

import { AREA, FLAG_SCOPE, HANDOUT_FOLDER_NAME } from "../constants";
import { computeOwnership, mergeOwnershipMaps, type Owner, type RevealState } from "./reveal-state";
import {
  defaultFlags,
  isHandout,
  readHandoutFlags,
  type HandoutFlags,
  type HandoutKind,
} from "./handout-flags";

/**
 * Resolves the non-GM User ids that hold OWNER-level permission on the given actor.
 * Uses `actor.ownership` (the raw permission map) and compares against `game.users`.
 * CONST is accessed inside the function body (not at module scope) to avoid failures
 * when the module is imported in unit-test environments without Foundry globals.
 */
export function resolveActorOwners(actorId: string): string[] {
  const actor = game.actors?.get(actorId);
  if (!actor) return [];
  // actor.ownership is typed as Record<string, number> in fvtt-types; cast to ensure
  // TS treats 'default' key access as a number lookup.
  const ownership = actor.ownership as Record<string, number> ?? {};
  // Defer CONST access to function body so this module can be imported without Foundry globals.
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const ids: string[] = [];
  for (const user of game.users ?? []) {
    if (user.isGM) continue;
    const level = ownership[user.id] ?? ownership["default"] ?? 0;
    if (level >= ownerLevel) ids.push(user.id);
  }
  return ids;
}

/** Unified view of a handout JournalEntry with its two pages and parsed flags. */
export interface HandoutDoc {
  entry: JournalEntry;
  flags: HandoutFlags;
  surfacePage: JournalEntryPage | null;
  secretPage: JournalEntryPage | null;
}

/** Returns the first page whose `area` flag matches the given area string. */
function pageByArea(entry: JournalEntry, area: string): JournalEntryPage | null {
  for (const page of entry.pages) {
    if (page.getFlag(FLAG_SCOPE, "area") === area) return page;
  }
  return null;
}

/**
 * Converts a JournalEntry to a HandoutDoc. Returns null if the entry
 * does not carry our module flags (i.e. is not a managed handout).
 */
function toDoc(entry: JournalEntry): HandoutDoc | null {
  const flags = readHandoutFlags(entry);
  if (!flags) return null;
  return {
    entry,
    flags,
    surfacePage: pageByArea(entry, AREA.surface),
    secretPage: pageByArea(entry, AREA.secret),
  };
}

/**
 * Returns true if the current user may manage (reveal) this handout:
 * GM always can; otherwise the user must hold OWNER-level permission on the handout's actor.
 */
export function canManage(doc: HandoutDoc): boolean {
  if (game.user?.isGM) return true;
  if (doc.flags.owner.kind !== "actor" || !doc.flags.owner.actorId) return false;
  const ownerUsers = resolveActorOwners(doc.flags.owner.actorId);
  return ownerUsers.includes(game.user?.id ?? "");
}

/** Retrieves a single HandoutDoc by JournalEntry id. Returns null if not found or not a handout. */
export function getHandoutDoc(id: string): HandoutDoc | null {
  const entry = game.journal?.get(id);
  return entry ? toDoc(entry) : null;
}

/** Returns all managed handout docs from game.journal. */
export function listHandoutDocs(): HandoutDoc[] {
  const out: HandoutDoc[] = [];
  for (const entry of game.journal ?? []) {
    if (!isHandout(entry)) continue;
    const doc = toDoc(entry);
    if (doc) out.push(doc);
  }
  return out;
}

/**
 * Ensures the dedicated handout folder exists, creating it if necessary.
 * Identifies the folder by type + name (not by flag).
 */
export async function ensureHandoutFolder(): Promise<Folder> {
  const existing = game.folders?.find(
    (f) => f.type === "JournalEntry" && f.name === HANDOUT_FOLDER_NAME,
  );
  if (existing) return existing;
  // Folder.create returns Folder | undefined; the non-null assertion is safe because
  // Foundry throws on failure rather than returning undefined in practice.
  return (await Folder.create({ name: HANDOUT_FOLDER_NAME, type: "JournalEntry" }))!;
}

/**
 * Derives page ownership maps from flags via computeOwnership.
 * This is the ONLY place ownership maps are constructed in this file.
 *
 * Cast rationale: OwnershipMap uses local OwnershipLevel (0|2|3) which are plain numbers;
 * fvtt-types expects Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS> where that type is a
 * Brand<number, "constants.DOCUMENT_OWNERSHIP_LEVELS">. The cast is safe because our values
 * (NONE=0, OBSERVER=2, OWNER=3) are exactly the runtime values Foundry expects.
 * We avoid `as any` on whole documents — the cast is localized to the ownership value only.
 */
function deriveOwnership(flags: HandoutFlags): {
  surface: Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS>;
  secret: Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS>;
  entry: Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS>;
} {
  const result = computeOwnership({
    owner: flags.owner,
    revealState: flags.revealState,
    resolveActorOwners,
  });
  // Double cast required: TS cannot directly narrow plain `number` to the branded type.
  // The via-`unknown` cast is safe: our OwnershipLevel values (0, 2, 3) are exactly the
  // NONE/OBSERVER/OWNER runtime integers Foundry expects; the brand is purely a compile-time marker.
  return {
    surface: result.surface as unknown as Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS>,
    secret: result.secret as unknown as Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS>,
    entry: mergeOwnershipMaps(result.surface, result.secret) as unknown as Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS>,
  };
}

/**
 * Creates a new handout JournalEntry with two pages (surface/secret).
 * Page ownership is derived from the default RevealState via computeOwnership.
 * Both pages receive an `area` flag to allow retrieval by pageByArea().
 */
export async function createHandoutDoc(args: {
  owner: Owner;
  kind: HandoutKind;
  tags?: string[];
  surface?: string;
  secret?: string;
  name?: string;
}): Promise<HandoutDoc> {
  const folder = await ensureHandoutFolder();
  const flags = defaultFlags(args.owner, args.kind, args.tags ?? []);
  const ownership = deriveOwnership(flags);

  // JournalEntry.create returns JournalEntry | undefined; non-null assertion is safe
  // because Foundry throws on failure.
  const entry = (await JournalEntry.create({
    name: args.name?.trim() || (args.kind === "pc" ? "PC 핸드아웃" : "공용 핸드아웃"),
    folder: folder.id,
    flags: { [FLAG_SCOPE]: flags },
    ownership: ownership.entry,
    pages: [
      {
        name: "표면",
        type: "text",
        text: { content: args.surface ?? "" },
        ownership: ownership.surface,
        flags: { [FLAG_SCOPE]: { area: AREA.surface } },
      },
      {
        name: "비밀",
        type: "text",
        text: { content: args.secret ?? "" },
        ownership: ownership.secret,
        flags: { [FLAG_SCOPE]: { area: AREA.secret } },
      },
    ],
  }))!;

  return toDoc(entry)!;
}

/**
 * 부분 flag 변경을 적용하고 ownership 을 재파생한다(가시성 변경의 단일 경로).
 * 1. partial 을 현재 flags 에 병합 → deriveOwnership 으로 surface/secret/entry 맵 재계산.
 * 2. 변경된 flag(merge)와 entry ownership 을 한 번의 update 로 persist 하고,
 *    두 page 의 ownership 을 갱신.
 * ownership 은 절대 직접 편집하지 않는다(불변식). revealState/meta 두 경로가 공유한다.
 */
export async function applyFlagsUpdate(doc: HandoutDoc, partial: Partial<HandoutFlags>): Promise<void> {
  const updatedFlags: HandoutFlags = { ...doc.flags, ...partial };
  const ownership = deriveOwnership(updatedFlags);

  // 변경된 flag(merge, create 가 쓰는 { [FLAG_SCOPE]: flags } 와 동일 패턴) + entry
  // ownership(= surface·secret element-wise MAX) 을 한 번의 update 로 함께 persist.
  await doc.entry.update({ flags: { [FLAG_SCOPE]: partial }, ownership: ownership.entry });
  // 두 page ownership 을 새 맵으로 갱신.
  if (doc.surfacePage) await doc.surfacePage.update({ ownership: ownership.surface });
  if (doc.secretPage) await doc.secretPage.update({ ownership: ownership.secret });
}

/**
 * 새 RevealState 를 적용한다. applyFlagsUpdate 위임(시그니처/동작 유지).
 * 호출부(api.revealSecret)는 변경 없음.
 */
export async function applyRevealState(doc: HandoutDoc, next: RevealState): Promise<void> {
  await applyFlagsUpdate(doc, { revealState: next });
}

/**
 * 핸드아웃 JournalEntry 를 삭제한다(두 page 함께 제거됨).
 * 미존재 id 는 조용히 no-op. 폴더(Handouts)는 삭제하지 않는다(엔트리만).
 * CRUD 대칭(create/get/list 옆의 delete). 직접 ownership 편집 없음(불변식 유지).
 */
export async function deleteHandoutDoc(id: string): Promise<void> {
  const doc = getHandoutDoc(id);
  if (!doc) return;
  await doc.entry.delete();
}
