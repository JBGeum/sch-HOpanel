import type { CategoryDict } from "./handout-flags";

/**
 * 사전 선택 태그 키(select)와 자유 입력(쉼표 구분)을 하나의 태그 배열로 정규화한다.
 * - freeText 를 ',' 로 분리 → 각 항목 trim → 빈 문자열 제거.
 * - selected 뒤에 이어붙인 뒤 Set 으로 중복 제거(입력 순서 보존).
 * Foundry 런타임 무의존이라 단위 테스트 가능(프로젝트 철학: 순수 함수만 Vitest).
 */
export function parseTags(selected: string[], freeText: string): string[] {
  const free = freeText
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set([...selected, ...free])];
}

/**
 * 현재 태그 배열을 편집 폼 입력(태그 select 선택 + 자유입력 문자열)으로 역변환한다.
 * - selected: dict 의 own property 인 태그(multiselect 에서 selected 표시). 순서 보존.
 * - free: dict 에 없는 태그들을 ", " 로 join(자유입력 input 에 prefill).
 * hasOwnProperty 로 판정해 'toString' 등 상속 속성명을 dict 키로 오분류하지 않는다.
 * parseTags 와 역연산: parseTags(selected, free) 는 원래 tags 와 "집합 동일"이며
 * dict 태그가 앞·자유 태그가 뒤로 정규화된다(칩 순서 무의미 — 허용).
 */
export function splitTagsForEdit(
  tags: string[],
  dict: CategoryDict,
): { selected: string[]; free: string } {
  const inDict = (t: string): boolean => Object.prototype.hasOwnProperty.call(dict, t);
  const selected = tags.filter(inDict);
  const free = tags.filter((t) => !inDict(t)).join(", ");
  return { selected, free };
}
