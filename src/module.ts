import { MODULE_ID } from "./constants";
import { registerSettings } from "./settings";
import { ExampleApp } from "./apps/example-app";
import { log } from "./utils/logger";
import "./styles/module.scss";

// 공개 API 의 타입은 src/foundry-config.d.ts 의 ModuleConfig 에 선언되어 있다.

Hooks.once("init", () => {
  log.info("Initializing");
  registerSettings();
  // 추가 init 작업(템플릿 사전 로드, CONFIG 확장, 커스텀 시트 등록 등)을 여기에 둔다.
});

Hooks.once("ready", () => {
  log.info("Ready");

  // 다른 모듈/매크로에서 game.modules.get("sch-boilerplate").api 로 접근 가능.
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      openExample: () => void new ExampleApp().render({ force: true }),
    };
  }

  // 런타임 Hook(renderXxx, createItem, updateActor 등)은 여기에 등록한다.
});
