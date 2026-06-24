import { MODULE_ID } from "./constants";
import { registerSettings } from "./settings";
import { log } from "./utils/logger";
import { buildApi } from "./api/index";
import "./styles/main.scss";

// 공개 API 타입은 src/foundry-config.d.ts 의 ModuleConfig 에 선언한다.

Hooks.once("init", () => {
  log.info("Initializing");
  registerSettings();
});

Hooks.once("ready", () => {
  log.info("Ready");
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = buildApi();
});
