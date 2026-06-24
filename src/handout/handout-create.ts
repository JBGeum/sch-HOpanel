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
