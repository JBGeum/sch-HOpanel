import { MODULE_ID, SETTINGS } from "../constants";

/** 모든 로그에 모듈 식별 prefix 를 붙여 디버깅을 쉽게 한다. */
const PREFIX = `${MODULE_ID} |`;

/** debugMode 설정이 켜진 경우에만 debug 로그를 출력한다. */
function isDebugEnabled(): boolean {
  try {
    return game.settings?.get(MODULE_ID, SETTINGS.debugMode) === true;
  } catch {
    // init 이전(설정 미등록) 등 settings 접근 불가 상황에서는 조용히 false.
    return false;
  }
}

export const log = {
  info: (...args: unknown[]): void => {
    if (isDebugEnabled()) console.log(PREFIX, ...args);
  },
  warn: (...args: unknown[]): void => {
    if (isDebugEnabled()) console.warn(PREFIX, ...args);
  },
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
  debug: (...args: unknown[]): void => {
    if (isDebugEnabled()) console.debug(PREFIX, ...args);
  },
};
