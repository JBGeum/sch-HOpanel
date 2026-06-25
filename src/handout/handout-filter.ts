/**
 * 패널 툴바용 순수 필터/그룹 로직. Foundry 런타임 무의존(HandoutView 만 입력) → 단위 테스트 가능.
 */
import type { HandoutView } from "./handout-view";
import type { HandoutKind } from "./handout-flags";

/** 내용 검색용: HTML 태그 제거(공백으로 치환). */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ");
}

/** 정규화: 소문자 + 모든 공백 제거. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/**
 * 검색 매치 등급: 1 = 제목/소유자 매치(상단), 2 = 내용만 매치(하단), 0 = 미매치(제외).
 * 빈 query 는 항상 1(전원 통과). 내용 = 표면 + 읽을 수 있는 비밀(null 이면 제외 → 누출 없음).
 */
export function searchTier(view: HandoutView, query: string): 0 | 1 | 2 {
  const q = norm(query);
  if (!q) return 1;
  if (norm(`${view.name} ${view.ownerName}`).includes(q)) return 1;
  const body = norm(`${stripHtml(view.surfaceContent)} ${stripHtml(view.secretContent ?? "")}`);
  if (body.includes(q)) return 2;
  return 0;
}

/**
 * 카테고리(단일) 필터 후, query 가 있으면 tier>0 만 남기고 tier 오름차순(원순서 유지) 정렬.
 * query 없으면 카테고리만 적용(원순서).
 */
export function filterViews<T extends HandoutView>(
  views: T[],
  opts: { query: string; tag: string },
): T[] {
  const tagged = opts.tag ? views.filter((v) => v.tags.some((t) => t.cat === opts.tag)) : views;
  if (!norm(opts.query)) return tagged;
  return tagged
    .map((v, i) => ({ v, i, tier: searchTier(v, opts.query) }))
    .filter((e) => e.tier > 0)
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((e) => e.v);
}

const KIND_LABEL: Record<HandoutKind, string> = { pc: "PC 핸드아웃", floating: "공용 핸드아웃" };
const KIND_ORDER: HandoutKind[] = ["pc", "floating"];

/** kind 별 그룹(pc→floating 순, 빈 그룹 생략). 입력 순서를 그룹 내에 유지. */
export function groupViewsByKind<T extends HandoutView>(
  views: T[],
): { kind: HandoutKind; label: string; rows: T[] }[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    rows: views.filter((v) => v.kind === kind),
  })).filter((g) => g.rows.length > 0);
}
