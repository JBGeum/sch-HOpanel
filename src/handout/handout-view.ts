import type { SecretMode, SurfaceMode } from "./reveal-state";
import type { CategoryDict } from "./handout-flags";
import { canManage, listHandoutDocs, type HandoutDoc } from "./handout-repo";

export interface Chip {
  area: "surface" | "secret";
  state: string;
  label: string;
  tone: string;
}
export interface TagView {
  cat: string;
  label: string;
}

export interface HandoutView {
  id: string;
  name: string;
  kind: "pc" | "floating";
  typeLabel: string;
  ownerName: string;
  tags: TagView[];
  surfaceChip: Chip;
  secretChip: Chip;
  surfaceContent: string;
  secretContent: string | null;
  secretLocked: boolean;
  secretRevealed: boolean;
  canManage: boolean;
}

const SURFACE_LABEL: Record<SurfaceMode, string> = {
  all: "전원",
  limited: "일부",
  hidden: "숨김",
};
const SURFACE_TONE: Record<SurfaceMode, string> = {
  all: "green",
  limited: "amber",
  hidden: "rose",
};
const SECRET_LABEL: Record<SecretMode, string> = {
  owner: "비공개",
  limited: "공개",
  all: "전원공개",
};
const SECRET_TONE: Record<SecretMode, string> = {
  owner: "slate",
  limited: "blue",
  all: "violet",
};

export function surfaceChip(mode: SurfaceMode, revealedCount: number): Chip {
  const label =
    mode === "limited" ? `${SURFACE_LABEL.limited} ${revealedCount}` : SURFACE_LABEL[mode];
  return { area: "surface", state: mode, label, tone: SURFACE_TONE[mode] };
}

export function secretChip(mode: SecretMode, revealedCount: number): Chip {
  const label =
    mode === "limited" ? `${SECRET_LABEL.limited} ${revealedCount}` : SECRET_LABEL[mode];
  return { area: "secret", state: mode, label, tone: SECRET_TONE[mode] };
}

export function resolveTags(tags: string[], dict: CategoryDict): TagView[] {
  return tags.map((cat) => ({ cat, label: dict[cat]?.label ?? cat }));
}

/** Foundry 상태 의존: page 내용/소유자 이름. 호출자(api)가 dict 를 settings 에서 주입한다. */
export function toHandoutView(doc: HandoutDoc, dict: CategoryDict = {}): HandoutView | null {
  const { entry, flags, surfacePage, secretPage } = doc;
  const rs = flags.revealState;

  const ownerName =
    flags.owner.kind === "actor" && flags.owner.actorId
      ? game.actors?.get(flags.owner.actorId)?.name ?? "(알 수 없음)"
      : "공용";

  const manage = canManage(doc);
  const secretReadable = manage || secretCanObserve(doc);

  return {
    id: entry.id ?? "",
    name: entry.name ?? "",
    kind: flags.kind,
    typeLabel: flags.kind === "pc" ? "PC" : "공용",
    ownerName,
    tags: resolveTags(flags.tags, dict),
    surfaceChip: surfaceChip(rs.surface.mode, rs.surface.revealedTo.length),
    secretChip: secretChip(rs.secret.mode, rs.secret.revealedTo.length),
    surfaceContent: surfacePage?.text?.content ?? "",
    secretContent: secretReadable ? secretPage?.text?.content ?? "" : null,
    secretLocked: !secretReadable,
    secretRevealed: rs.secret.mode !== "owner",
    canManage: manage,
  };
}

/** 현재 유저가 비밀 page 의 OBSERVER 이상인지(데이터가 전송됐는지로 근사). */
function secretCanObserve(doc: HandoutDoc): boolean {
  const uid = game.user?.id ?? "";
  const o = doc.secretPage?.ownership ?? {};
  const level = (o as Record<string, number>)[uid] ?? (o as Record<string, number>).default ?? 0;
  return level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
}

/**
 * 현재 유저에게 "보이는" 핸드아웃 view 목록.
 * 패널 _prepareContext 와 반응성 핸들러가 공유하는 단일 가시성 출처.
 * 표면 hidden 이고 관리 불가면 카드 자체를 제외한다(비권한자 미표시).
 */
export function listVisibleViews(dict: CategoryDict = {}): HandoutView[] {
  return listHandoutDocs()
    .map((doc) => toHandoutView(doc, dict))
    .filter((v): v is HandoutView => v !== null)
    .filter((v) => !(v.surfaceChip.state === "hidden" && !v.canManage));
}
