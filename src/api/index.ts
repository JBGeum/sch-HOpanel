import {
  applyRevealState,
  canManage,
  createHandoutDoc,
  deleteHandoutDoc,
  getHandoutDoc,
  listHandoutDocs,
  type HandoutDoc,
} from "../handout/handout-repo";
import type { Owner, RevealState, SecretMode } from "../handout/reveal-state";
import type { HandoutKind, CategoryDict } from "../handout/handout-flags";
import { toHandoutView, type HandoutView } from "../handout/handout-view";
import { getSetting, DEFAULT_CATEGORY_DICT } from "../settings";
import { SETTINGS } from "../constants";
import { log } from "../utils/logger";

export interface HandoutApi {
  getHandout(id: string): HandoutView | null;
  listHandouts(filter?: { owner?: Owner; kind?: HandoutKind; tag?: string }): HandoutView[];
  getRevealState(id: string): RevealState | null;
  createHandout(args: {
    owner: Owner;
    kind: HandoutKind;
    tags?: string[];
    surface?: string;
    secret?: string;
  }): Promise<HandoutView>;
  revealSecret(id: string, targetActorIds: string[]): Promise<void>;
  deleteHandout(id: string): Promise<void>;
}

export function buildApi(): HandoutApi {
  const dict = (): CategoryDict =>
    (getSetting(SETTINGS.categoryDict) as CategoryDict) ?? DEFAULT_CATEGORY_DICT;

  return {
    getHandout(id) {
      const doc = getHandoutDoc(id);
      return doc ? toHandoutView(doc, dict()) : null;
    },

    listHandouts(filter) {
      let docs = listHandoutDocs();
      if (filter?.kind) docs = docs.filter((d) => d.flags.kind === filter.kind);
      if (filter?.tag) docs = docs.filter((d) => d.flags.tags.includes(filter.tag!));
      if (filter?.owner)
        // TODO(Task 8): gm-kind owners have undefined actorId on both sides; refine owner filtering.
        docs = docs.filter((d) => d.flags.owner.actorId === filter.owner!.actorId);
      return docs.map((d) => toHandoutView(d, dict())).filter((v): v is HandoutView => v !== null);
    },

    getRevealState(id) {
      const doc = getHandoutDoc(id);
      return doc ? structuredClone(doc.flags.revealState) : null;
    },

    async createHandout(args) {
      if (!game.user?.isGM) throw new Error("createHandout: GM only");
      const doc = await createHandoutDoc(args);
      return toHandoutView(doc, dict())!;
    },

    async revealSecret(id, targetActorIds) {
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`revealSecret: handout not found: ${id}`);
      // 적용 직전 권한 검증(변조 방지)
      if (!canManage(doc)) throw new Error("revealSecret: not authorized");

      const prev = doc.flags.revealState.secret;
      const merged = [...new Set([...prev.revealedTo, ...targetActorIds])];
      const nextMode: SecretMode = prev.mode === "owner" ? "limited" : prev.mode; // owner→limited 승격
      const next: RevealState = {
        surface: doc.flags.revealState.surface,
        secret: { mode: nextMode, revealedTo: merged },
      };
      await applyRevealState(doc, next);
    },

    async deleteHandout(id) {
      if (!game.user?.isGM) throw new Error("deleteHandout: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) {
        log.warn("deleteHandout: handout not found, no-op:", id);
        return;
      }
      await deleteHandoutDoc(id);
    },
  };
}
