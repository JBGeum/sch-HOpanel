/**
 * 모듈 전역 상수. 새 모듈로 옮길 때 MODULE_ID 만 바꾸면 된다.
 * (public/module.json 의 "id" 와 반드시 일치해야 한다)
 */
export const MODULE_ID = "sch-handout-panel";

/** 설정 키. 매직 스트링을 한 곳에서 관리한다. */
export const SETTINGS = {
  /** world 스코프: 최초 인사 완료 여부 */
  welcomed: "welcomed",
  /** client 스코프: UI 힌트 표시 여부 */
  showHints: "showHints",
  /** client 스코프: 개발용 디버그 로그 토글 */
  debugMode: "debugMode",
} as const;

export type SettingKey = (typeof SETTINGS)[keyof typeof SETTINGS];
