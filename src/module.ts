import { MODULE_ID } from "./constants";
import { registerSettings } from "./settings";
import { log } from "./utils/logger";
import { buildApi } from "./api/index";
import { HandoutPanel } from "./apps/handout-panel";
import "./styles/main.scss";

// 공개 API 타입은 src/foundry-config.d.ts 의 ModuleConfig 에 선언한다.

Hooks.once("init", () => {
  log.info("Initializing");
  registerSettings();
  // 행 partial 을 Handlebars 에 등록한다.
  // 객체 형태로 loadTemplates 를 호출하면 키가 partial 이름이 된다.
  // handout-panel.hbs 에서 {{> handout-row this}} 로 참조한다.
  void loadTemplates({
    "handout-row": `modules/${MODULE_ID}/templates/handout-row.hbs`,
  });
});

Hooks.once("ready", () => {
  log.info("Ready");
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = buildApi();
});

// Scene Controls 툴바에 패널 열기 버튼 등록
// V13에서 controls는 Record<string, SceneControls.Control> 객체이다.
// Tool.button: true → 상태 없는 버튼, onChange로 클릭 이벤트 수신.
Hooks.on("getSceneControlButtons", (controls) => {
  controls["sch-handout-panel"] = {
    name: "sch-handout-panel",
    order: 10,
    title: "SCH.Controls.HandoutPanel",
    icon: "fa-solid fa-scroll",
    visible: true,
    activeTool: "open-panel",
    tools: {
      "open-panel": {
        name: "open-panel",
        order: 1,
        title: "SCH.Controls.OpenPanel",
        icon: "fa-solid fa-scroll",
        button: true,
        onChange: () => void new HandoutPanel().render({ force: true }),
      },
    },
  };
});
