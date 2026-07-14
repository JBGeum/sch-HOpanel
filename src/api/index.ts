import {
  applyFlagsUpdate,
  applyRevealState,
  canManage,
  createHandoutDoc,
  deleteHandoutDoc,
  getHandoutDoc,
  listHandoutDocs,
  reorderHandoutDocs,
  updateHandoutBodyDoc,
  type HandoutDoc,
} from "../handout/handout-repo";
import { computeRetractSecret } from "../handout/reveal-state";
import type { Owner, RevealState, SecretMode, SurfaceMode } from "../handout/reveal-state";
import type { HandoutKind } from "../handout/handout-flags";
import { toHandoutView, type HandoutView } from "../handout/handout-view";
import { getSetting } from "../settings";
import { SETTINGS } from "../constants";
import { log } from "../utils/logger";
import { buildChatCard } from "../handout/handout-chat";

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
  updateHandoutBody(id: string, body: { surface?: string; secret?: string }): Promise<void>;
  setSurfaceVisibility(
    id: string,
    surface: { mode: SurfaceMode; revealedTo: string[] },
  ): Promise<void>;
  shareToChat(id: string, area: "surface" | "secret"): Promise<void>;
  reorderHandouts(updates: { id: string; order: number }[]): Promise<void>;
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

    async retractSecret(id, targetActorIds) {
      if (!game.user?.isGM) throw new Error("retractSecret: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`retractSecret: handout not found: ${id}`);

      // 회수 대상 + 삭제된 액터를 함께 제거하고, 남는 게 없으면 owner 로 강등(computeRetractSecret).
      // 삭제된 액터가 revealedTo 에 잔존해 발생하던 회수 불가 고착도 이 경로로 정리된다.
      const prev = doc.flags.revealState.secret;
      if (prev.mode === "owner") return; // 회수 대상 없음(no-op)
      const next = computeRetractSecret(prev, targetActorIds, (actorId) => !!game.actors?.get(actorId));
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

    async updateHandoutBody(id, body) {
      if (!game.user?.isGM) throw new Error("updateHandoutBody: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`updateHandoutBody: handout not found: ${id}`);
      await updateHandoutBodyDoc(doc, body);
    },

    async setSurfaceVisibility(id, surface) {
      if (!game.user?.isGM) throw new Error("setSurfaceVisibility: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`setSurfaceVisibility: handout not found: ${id}`);
      await applyFlagsUpdate(doc, {
        revealState: { ...doc.flags.revealState, surface },
      });
    },

    async shareToChat(id, area) {
      if (!game.user?.isGM) throw new Error("shareToChat: GM only");
      const doc = getHandoutDoc(id);
      if (!doc) throw new Error(`shareToChat: handout not found: ${id}`);
      const page = area === "surface" ? doc.surfacePage : doc.secretPage;
      const o = doc.flags.owner;
      const ownerName =
        o.kind === "actor" && o.actorId ? game.actors?.get(o.actorId)?.name ?? "(알 수 없음)" : "공용";
      const content = buildChatCard({
        name: doc.entry.name ?? "",
        typeLabel: doc.flags.kind === "pc" ? "PC" : "공용",
        kind: doc.flags.kind,
        ownerName,
        area,
        body: page?.text?.content ?? "",
        theme: (getSetting(SETTINGS.theme) as string) ?? "light",
      });
      await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker() });
    },

    async reorderHandouts(updates) {
      if (!game.user?.isGM) throw new Error("reorderHandouts: GM only");
      await reorderHandoutDocs(updates);
    },
  };
}
