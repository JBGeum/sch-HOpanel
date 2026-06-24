import { MODULE_ID } from "./constants";
import { registerSettings } from "./settings";
import { log } from "./utils/logger";
import "./styles/main.scss";

// 공개 API 타입은 src/foundry-config.d.ts 의 ModuleConfig 에 선언한다.

Hooks.once("init", () => {
  log.info("Initializing");
  registerSettings();
});

Hooks.once("ready", () => {
  log.info("Ready");
  // API 등록·패널 컨트롤은 Task 5/7 에서 추가한다.
});
