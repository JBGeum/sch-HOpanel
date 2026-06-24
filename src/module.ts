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
//
// V13에서 controls 는 Record<string, SceneControls.Control> 객체이다.
// 런타임 v13 의 비-토글 도구 콜백 필드는 `onClick: () => void` 이다
// (출처: foundryvtt.wiki canvas 문서). 그러나 설치된 fvtt-types(13.346.0-beta)
// SceneControls.Tool 선언에는 `onClick` 가 없고 `onChange` 만 있다 → fvtt-types 가
// v13 런타임보다 뒤처져 있다. 또한 control-level `onClick` 도 선언되어 있지 않다.
// 안전을 위해 onClick(런타임 정답) 을 control 과 tool 양쪽에 둔다.
// fvtt-types 에 없는 onClick 필드만 좁은 범위로 캐스팅한다(전체 as any 금지).
const open = () => void new HandoutPanel().render({ force: true });
type WithOnClick = { onClick?: (...args: unknown[]) => void };

Hooks.on("getSceneControlButtons", (controls) => {
  const tool: foundry.applications.ui.SceneControls.Tool & WithOnClick = {
    name: "open-panel",
    order: 1,
    title: "SCH.Controls.OpenPanel",
    icon: "fa-solid fa-scroll",
    button: true,
    onChange: open,
    onClick: open,
  };
  const control: foundry.applications.ui.SceneControls.Control & WithOnClick = {
    name: "sch-handout-panel",
    order: 10,
    title: "SCH.Controls.HandoutPanel",
    icon: "fa-solid fa-scroll",
    visible: true,
    activeTool: "open-panel",
    onChange: open,
    onClick: open,
    tools: { "open-panel": tool },
  };
  controls["sch-handout-panel"] = control;
});
