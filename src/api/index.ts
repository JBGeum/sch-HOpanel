import {
  applyFlagsUpdate,
  applyRevealState,
  canManage,
  createHandoutDoc,
  deleteHandoutDoc,
  getHandoutDoc,
  listHandoutDocs,
  type HandoutDoc,
} from "../handout/handout-repo";
import type { Owner, RevealState, SecretMode, SurfaceMode } from "../handout/reveal-state";
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
    name?: string;
  }): Promise<HandoutView>;
  revealSecret(id: string, targetActorIds: string[]): Promise<void>;
  retractSecret(id: string, targetActorIds: string[]): Promise<void>;
  deleteHandout(id: string): Promise<void>;
  updateHandoutMeta(
    id: string,
    meta: { owner: Owner; kind: HandoutKind; tags: string[]; name: string },
  ): Promise<void>;
  setSurfaceVisibility(
    id: string,
    surface: { mode: SurfaceMode; revealedTo: string[] },
  ): Promise<void>;
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

    async retractSecret(id, targetActorIds) {
      if (!game.user?.isGM) throw new Error("retractSecret: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`retractSecret: handout not found: ${id}`);

      const prev = doc.flags.revealState.secret;
      let next: RevealState["secret"];
      if (prev.mode === "all") {
        next = { mode: "owner", revealedTo: [] }; // 전체 회수
      } else if (prev.mode === "limited") {
        const remaining = prev.revealedTo.filter((a) => !targetActorIds.includes(a));
        next = remaining.length
          ? { mode: "limited", revealedTo: remaining }
          : { mode: "owner", revealedTo: [] }; // 다 빠지면 비공개
      } else {
        return; // owner — 회수 대상 없음(no-op)
      }
      await applyRevealState(doc, { surface: doc.flags.revealState.surface, secret: next });
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

    async updateHandoutMeta(id, meta) {
      if (!game.user?.isGM) throw new Error("updateHandoutMeta: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`updateHandoutMeta: handout not found: ${id}`);
      // name 은 flag 가 아니라 entry 필드 → flags 와 분리해 처리(가시성/ownership 경로 불변).
      const { name, ...flags } = meta;
      await applyFlagsUpdate(doc, flags);
      const nextName = name.trim() || (meta.kind === "pc" ? "PC 핸드아웃" : "공용 핸드아웃");
      if (nextName !== doc.entry.name) await doc.entry.update({ name: nextName });
    },

    async setSurfaceVisibility(id, surface) {
      if (!game.user?.isGM) throw new Error("setSurfaceVisibility: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`setSurfaceVisibility: handout not found: ${id}`);
      await applyFlagsUpdate(doc, {
        revealState: { ...doc.flags.revealState, surface },
      });
    },
  };
}
