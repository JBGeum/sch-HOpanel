/**
 * reveal-detect: "나에게 보이는 핸드아웃" 집합의 지문과 그 diff(새 공개 검출).
 * 순수 함수만 — Foundry 글로벌에 의존하지 않는다(Vitest 대상).
 */
import type { HandoutView } from "./handout-view";

/** 지문 입력: 검출에 필요한 최소 필드만. (caller 는 HandoutView[] 를 그대로 전달.) */
type FingerprintInput = Pick<HandoutView, "id" | "secretLocked">;

/** id → secretLocked. 현재 유저에게 "보이는" 핸드아웃의 지문. */
export function buildFingerprint(views: readonly FingerprintInput[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const v of views) m.set(v.id, v.secretLocked);
  return m;
}

/**
 * 직전 지문 대비 "새로 공개된" 핸드아웃 id를 검출한다.
 * - 표면 신규: next 에만 있는 id(생성/숨김해제/대상포함으로 새로 보임).
 * - 비밀 잠금해제: 양쪽에 있고 prev.secretLocked === true && next.secretLocked === false.
 * 회수(false→true)·사라짐(next 없음)은 공개가 아니므로 제외.
 */
export function diffReveals(
  prev: Map<string, boolean>,
  next: Map<string, boolean>,
): { revealedIds: string[] } {
  const revealedIds: string[] = [];
  for (const [id, locked] of next) {
    if (!prev.has(id)) revealedIds.push(id);
    else if (prev.get(id) === true && locked === false) revealedIds.push(id);
  }
  return { revealedIds };
}
