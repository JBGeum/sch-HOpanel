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

// Scene Controls 툴바에 패널 열기 버튼 등록 (V13: controls 는 Record<name, Control>).
//
// 패널은 싱글턴으로 재사용한다. 매 클릭마다 new 하면 동일 id(AppV2) 인스턴스가
// 중복 생성되고, position.height:"auto" 측정이 분리된 프레임을 만나
// _updatePosition 에서 offsetWidth(null) 로 크래시한다(재오픈 시 재현).
// 닫혀 있으면 render, 떠 있으면 앞으로 가져온다(멱등) → 중복/분리렌더 차단.
let panel: HandoutPanel | null = null;
const open = () => {
  panel ??= new HandoutPanel();
  if (panel.rendered) panel.bringToFront?.();
  else void panel.render({ force: true });
};

// V13 런타임 로그로 확인된 동작: onChange/onClick 둘 다 "클릭" 이벤트가 아니라
// 컨트롤 활성상태 전이(active true↔false)에서만 발화하며 active 값을 인자로 받는다.
// onClick 은 비활성화 시 [false] 로도 발화하므로 클릭 핸들러로 쓰면 "다른 컨트롤을
// 선택하면 패널이 뜨는" 오발화가 난다 → onClick 은 쓰지 않고, onChange 에서
// active===true 일 때만 연다(a[1] = active boolean). 활성 컨트롤 재클릭은 전이가
// 없어 어떤 콜백도 부르지 않으므로, 재오픈은 패널 _onClose 가 컨트롤을 비활성화해
// false→true 전이를 복원하는 방식으로 처리한다(handout-panel.ts).
const onChange = (...a: unknown[]) => {
  const active = a[1];
  if (active) open();
};

Hooks.on("getSceneControlButtons", (controls) => {
  const tool: foundry.applications.ui.SceneControls.Tool = {
    name: "open-panel",
    order: 1,
    title: "SCH.Controls.OpenPanel",
    icon: "fa-solid fa-scroll",
    button: true,
    onChange,
  };
  const control: foundry.applications.ui.SceneControls.Control = {
    name: "sch-handout-panel",
    order: 10,
    title: "SCH.Controls.HandoutPanel",
    icon: "fa-solid fa-scroll",
    visible: true,
    activeTool: "open-panel",
    onChange,
    tools: { "open-panel": tool },
  };
  controls["sch-handout-panel"] = control;
});
