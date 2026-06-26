/**
 * 핸드아웃 순서(order flag) 정렬·재배치 순수 로직. Foundry 무의존 → Vitest 단위 테스트.
 */

/**
 * order 오름차순 안정 정렬. getOrder 가 undefined 를 반환하는 항목은 맨 뒤로 보내되
 * 입력 순서를 보존한다(동일 order, 또는 둘 다 undefined 인 경우도 입력 순서 유지).
 * 입력 배열은 변형하지 않는다(인덱스 동반 매핑 → sort → 추출).
 */
export function sortByOrder<T>(items: T[], getOrder: (item: T) => number | undefined): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        (getOrder(a.item) ?? Infinity) - (getOrder(b.item) ?? Infinity) || a.i - b.i,
    )
    .map((e) => e.item);
}
