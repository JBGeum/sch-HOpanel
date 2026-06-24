import { MODULE_ID, SETTINGS } from "../constants";
import { getSetting, setSetting } from "../settings";
import { log } from "../utils/logger";

// v13 권장: ApplicationV2 + HandlebarsApplicationMixin
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// 컨텍스트는 ApplicationV2 의 기본 RenderContext 를 확장한다(tabs 등 기본 필드 포함).
interface ExampleContext extends foundry.applications.api.ApplicationV2.RenderContext {
  moduleId: string;
  welcomed: boolean;
  showHints: boolean;
}

/**
 * 예제 창. 새 UI 를 만들 때 이 파일을 복사해 PARTS/_prepareContext/액션만 교체한다.
 */
export class ExampleApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static override DEFAULT_OPTIONS = {
    id: "sch-handout-panel-example",
    tag: "div",
    window: {
      title: "SCH.ExampleApp.Title",
      icon: "fa-solid fa-cube",
    },
    position: {
      width: 480,
      height: "auto" as const,
    },
    actions: {
      // data-action="greet" 버튼과 연결된다.
      greet: ExampleApp.#onGreet,
    },
  };

  static override PARTS = {
    main: {
      // dist 가 Foundry 의 modules/<id>/ 로 배치되므로 이 경로가 유효하다.
      template: `modules/${MODULE_ID}/templates/example-app.hbs`,
    },
  };

  override async _prepareContext(
    options: foundry.applications.api.ApplicationV2.RenderOptions & { isFirstRender: boolean },
  ): Promise<ExampleContext> {
    const base = await super._prepareContext(options);
    return {
      ...base,
      moduleId: MODULE_ID,
      welcomed: getSetting(SETTINGS.welcomed),
      showHints: getSetting(SETTINGS.showHints),
    };
  }

  /** 액션 핸들러. this 는 앱 인스턴스로 바인딩된다. */
  static async #onGreet(this: ExampleApp): Promise<void> {
    log.debug("Greet action triggered");
    ui.notifications?.info(game.i18n.localize("SCH.ExampleApp.Greeting"));
    await setSetting(SETTINGS.welcomed, true);
    void this.render();
  }
}
