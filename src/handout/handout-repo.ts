/**
 * handout-repo: JournalEntry CRUD, folder management, and ownership derivation.
 * All page ownership is derived exclusively via computeOwnership (single source of truth).
 * No direct ownership map construction anywhere in this file.
 */

import { AREA, FLAG_SCOPE, HANDOUT_FOLDER_NAME } from "../constants";
import { computeOwnership, type Owner, type RevealState } from "./reveal-state";
import {
  defaultFlags,
  isHandout,
  readHandoutFlags,
  type HandoutFlags,
  type HandoutKind,
} from "./handout-flags";

/** Foundry OWNER level constant (used for actor ownership threshold check). */
const OWNER_LEVEL = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

/**
 * Resolves the non-GM User ids that hold OWNER-level permission on the given actor.
 * Uses `actor.ownership` (the raw permission map) and compares against `game.users`.
 */
export function resolveActorOwners(actorId: string): string[] {
  const actor = game.actors?.get(actorId);
  if (!actor) return [];
  // actor.ownership is typed as Record<string, number> in fvtt-types; cast to ensure
  // TS treats 'default' key access as a number lookup.
  const ownership = actor.ownership as Record<string, number> ?? {};
  const ids: string[] = [];
  for (const user of game.users ?? []) {
    if (user.isGM) continue;
    const level = ownership[user.id] ?? ownership["default"] ?? 0;
    if (level >= OWNER_LEVEL) ids.push(user.id);
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
}): Promise<HandoutDoc> {
  const folder = await ensureHandoutFolder();
  const flags = defaultFlags(args.owner, args.kind, args.tags ?? []);
  const ownership = deriveOwnership(flags);

  // JournalEntry.create returns JournalEntry | undefined; non-null assertion is safe
  // because Foundry throws on failure.
  const entry = (await JournalEntry.create({
    name: args.kind === "pc" ? "PC 핸드아웃" : "떠도는 핸드아웃",
    folder: folder.id,
    flags: { [FLAG_SCOPE]: flags },
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
 * Applies a new RevealState to a HandoutDoc:
 * 1. Persists the new revealState flag on the JournalEntry.
 * 2. Re-derives ownership via computeOwnership and updates BOTH pages.
 *
 * This ensures the single-source-of-truth constraint: ownership is never
 * set directly, always derived from the current flags.
 */
export async function applyRevealState(doc: HandoutDoc, next: RevealState): Promise<void> {
  // Compose updated flags locally for ownership derivation (do not mutate doc).
  const updatedFlags: HandoutFlags = { ...doc.flags, revealState: next };
  const ownership = deriveOwnership(updatedFlags);

  // Persist flag first so the entry's stored state matches the derived ownership.
  await doc.entry.setFlag(FLAG_SCOPE, "revealState", next);
  // Update both pages' ownership to match the newly derived maps.
  if (doc.surfacePage) await doc.surfacePage.update({ ownership: ownership.surface });
  if (doc.secretPage) await doc.secretPage.update({ ownership: ownership.secret });
}
