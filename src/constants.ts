/**
 * 모듈 전역 상수. flag 네임스페이스·설정 키·area·훅 이름을 한 곳에서 관리한다.
 */
export const MODULE_ID = "sch-handout-panel";

/** flag 스코프 = 모듈 ID. JournalEntry/Page 의 flags[FLAG_SCOPE] 에 데이터를 둔다. */
export const FLAG_SCOPE = MODULE_ID;

/** page 가 표면/비밀 중 무엇인지: page.flags[FLAG_SCOPE].area 에 저장. */
export const AREA = { surface: "surface", secret: "secret" } as const;
export type Area = (typeof AREA)[keyof typeof AREA];

/** 핸드아웃 전용 폴더 이름. 식별은 flag 기준이며 폴더는 보조(STEP §10). */
export const HANDOUT_FOLDER_NAME = "Handouts";

/** 설정 키. */
export const SETTINGS = {
  /** client: 패널 테마("light"|"dark") */
  theme: "theme",
  /** world: 카테고리 사전 (key → {label, tone}) */
  categoryDict: "categoryDict",
  /** client: 개발용 디버그 로그 토글 */
  debugMode: "debugMode",
} as const;

export type SettingKey = (typeof SETTINGS)[keyof typeof SETTINGS];

/** 훅 이름 prefix(P2 에서 사용, P0 은 선언만). */
export const HOOKS = {
  reveal: "schHandoutPanel.reveal",
} as const;
