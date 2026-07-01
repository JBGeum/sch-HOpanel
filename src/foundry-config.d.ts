/**
 * fvtt-types 선언 병합(declaration merging) 설정.
 *
 * 이 파일이 모듈 타입 안정성의 핵심이다. 새 설정/모듈 API 를 추가할 때
 * 여기 인터페이스에 한 줄씩 추가하면 game.settings / game.modules 호출이 타입 검사된다.
 *
 * 주의: 키 문자열은 src/constants.ts 의 MODULE_ID/SETTINGS 와 반드시 일치시켜야 한다
 * (인터페이스 키에는 리터럴 문자열만 쓸 수 있어 상수를 직접 참조할 수 없다).
 */

// 이 파일을 ESM 모듈로 만들어야 아래 declare module 이 "새 선언"이 아닌 "보강"으로 처리된다.
export {};

declare module "fvtt-types/configuration" {
  /**
   * getSceneControlButtons is rewritten in v13; fvtt-types has it commented out.
   * Augment Hooks.HookConfig directly so Hooks.on("getSceneControlButtons", ...) type-checks.
   * controls is a Record<string, SceneControls.Control> object in v13 (not an array).
   */
  namespace Hooks {
    interface HookConfig {
      getSceneControlButtons: (
        controls: Record<string, foundry.applications.ui.SceneControls.Control>,
      ) => void;
    }
  }
  /**
   * "ready" 훅이 실행된 이후를 가정하여 game / game.settings / game.i18n 등을
   * undefined 가 아닌 초기화된 타입으로 다룬다. 모듈 코드는 init 이후에 실행되므로 안전하다.
   */
  interface AssumeHookRan {
    ready: never;
  }

  /** game.settings.register/get/set 에서 사용할 설정 키와 값 타입. */
  interface SettingConfig {
    "sch-handout-panel.theme": string;
    "sch-handout-panel.fontScale": number;
    "sch-handout-panel.panelWidth": number;
    "sch-handout-panel.debugMode": boolean;
  }

  /**
   * JournalEntry flag 타입 선언. JournalEntry.getFlag / setFlag 에서 타입이 추론된다.
   * 구조: FlagConfig[DocumentName][Scope][FlagKey] = ValueType
   */
  interface FlagConfig {
    JournalEntry: {
      "sch-handout-panel": {
        owner: import("./handout/reveal-state").Owner;
        kind: import("./handout/handout-flags").HandoutKind;
        tags: string[];
        order: number;
        revealState: import("./handout/reveal-state").RevealState;
      };
    };
    /** JournalEntryPage flag 타입 선언. page.getFlag / setFlag 에서 타입이 추론된다. */
    JournalEntryPage: {
      "sch-handout-panel": {
        /** 페이지 구분: "surface" 또는 "secret". */
        area: import("./constants").Area;
      };
    };
  }

  /** game.modules.get("sch-handout-panel").api 로 노출되는 공개 API 타입. */
  interface ModuleConfig {
    "sch-handout-panel": {
      api: import("./api/index").HandoutApi;
    };
  }
}
