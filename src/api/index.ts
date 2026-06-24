import {
  applyRevealState,
  canManage,
  createHandoutDoc,
  getHandoutDoc,
  listHandoutDocs,
  type HandoutDoc,
} from "../handout/handout-repo";
import type { Owner, RevealState, SecretMode } from "../handout/reveal-state";
import type { HandoutKind } from "../handout/handout-flags";
import { toHandoutView, type HandoutView } from "../handout/handout-view";

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
}

export function buildApi(): HandoutApi {
  return {
    getHandout(id) {
      const doc = getHandoutDoc(id);
      return doc ? toHandoutView(doc) : null;
    },

    listHandouts(filter) {
      let docs = listHandoutDocs();
      if (filter?.kind) docs = docs.filter((d) => d.flags.kind === filter.kind);
      if (filter?.tag) docs = docs.filter((d) => d.flags.tags.includes(filter.tag!));
      if (filter?.owner)
        // TODO(Task 8): gm-kind owners have undefined actorId on both sides; refine owner filtering.
        docs = docs.filter((d) => d.flags.owner.actorId === filter.owner!.actorId);
      return docs.map((d) => toHandoutView(d)).filter((v): v is HandoutView => v !== null);
    },

    getRevealState(id) {
      const doc = getHandoutDoc(id);
      return doc ? structuredClone(doc.flags.revealState) : null;
    },

    async createHandout(args) {
      if (!game.user?.isGM) throw new Error("createHandout: GM only");
      const doc = await createHandoutDoc(args);
      return toHandoutView(doc)!;
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
  };
}
