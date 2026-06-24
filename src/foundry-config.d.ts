/**
 * fvtt-types 선언 병합(declaration merging) 설정.
 *
 * 이 파일이 boilerplate 타입 안정성의 핵심이다. 새 설정/모듈 API 를 추가할 때
 * 여기 인터페이스에 한 줄씩 추가하면 game.settings / game.modules 호출이 타입 검사된다.
 *
 * 주의: 키 문자열은 src/constants.ts 의 MODULE_ID/SETTINGS 와 반드시 일치시켜야 한다
 * (인터페이스 키에는 리터럴 문자열만 쓸 수 있어 상수를 직접 참조할 수 없다).
 */

// 이 파일을 ESM 모듈로 만들어야 아래 declare module 이 "새 선언"이 아닌 "보강"으로 처리된다.
export {};

declare module "fvtt-types/configuration" {
  /**
   * "ready" 훅이 실행된 이후를 가정하여 game / game.settings / game.i18n 등을
   * undefined 가 아닌 초기화된 타입으로 다룬다. 모듈 코드는 init 이후에 실행되므로 안전하다.
   */
  interface AssumeHookRan {
    ready: never;
  }

  /** game.settings.register/get/set 에서 사용할 설정 키와 값 타입. */
  interface SettingConfig {
    "sch-boilerplate.welcomed": boolean;
    "sch-boilerplate.showHints": boolean;
    "sch-boilerplate.debugMode": boolean;
  }

  /** game.modules.get("sch-boilerplate").api 로 노출되는 공개 API 타입. */
  interface ModuleConfig {
    "sch-boilerplate": {
      api: {
        openExample: () => void;
      };
    };
  }
}
