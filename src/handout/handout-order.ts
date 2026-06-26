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
        // 둘 다 undefined → Infinity - Infinity = NaN(falsy) → || 우항 a.i - b.i 로 fall-through(입력 순서 보존).
        (getOrder(a.item) ?? Infinity) - (getOrder(b.item) ?? Infinity) || a.i - b.i,
    )
    .map((e) => e.item);
}

/**
 * 드롭 결과를 새 order 맵으로 변환한다.
 * 정렬된 전체 시퀀스(items, 현재 order 값 포함)에서 movedId 를 빼고 targetId 의
 * before/after 위치에 삽입한 뒤 0..n-1 로 재번호한다. order 가 실제로 바뀐 항목만
 * {id, order} 로 반환한다(레거시 undefined → 정수도 "바뀜"으로 본다 → 첫 드래그 시 전체 정규화).
 * 같은 자리(moved===target)·부재 id 는 빈 배열(no-op).
 */
export function computeReorder(
  items: { id: string; order?: number }[],
  movedId: string,
  targetId: string,
  pos: "before" | "after",
): { id: string; order: number }[] {
  if (movedId === targetId) return [];
  const ids = items.map((it) => it.id);
  if (!ids.includes(movedId) || !ids.includes(targetId)) return [];

  const without = items.filter((it) => it.id !== movedId);
  const targetPos = without.findIndex((it) => it.id === targetId);
  const insertAt = targetPos + (pos === "after" ? 1 : 0);
  const movedItem = items.find((it) => it.id === movedId)!;
  const next = [...without.slice(0, insertAt), movedItem, ...without.slice(insertAt)];

  const updates: { id: string; order: number }[] = [];
  next.forEach((it, newOrder) => {
    if (it.order !== newOrder) updates.push({ id: it.id, order: newOrder });
  });
  return updates;
}
