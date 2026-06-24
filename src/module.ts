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
  // 행 partial 을 Handlebars 에 등록한다. loadTemplates 에 넘기면 경로명이 partial 이름이 된다.
  // handout-panel.hbs 에서 {{> handout-row this}} 로 참조한다.
  void loadTemplates([
    `modules/${MODULE_ID}/templates/handout-row.hbs`,
  ]);
});

Hooks.once("ready", () => {
  log.info("Ready");
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = buildApi();
});

// Journal 사이드바 하단에 패널 열기 버튼
// Cast rationale: fvtt-types renderJournalDirectory hook signature has html typed as unknown
// (or JQuery in older versions). We cast to HTMLElement — the V13 runtime passes HTMLElement.
Hooks.on("renderJournalDirectory", (_app: unknown, html: unknown) => {
  const el = html as HTMLElement;
  if (el.querySelector(".shp-open-panel")) return;
  const btn = document.createElement("button");
  btn.className = "shp-open-panel";
  btn.type = "button";
  btn.innerHTML = `<i class="fa-solid fa-scroll"></i> 핸드아웃 패널`;
  btn.addEventListener("click", () => void new HandoutPanel().render({ force: true }));
  el.querySelector(".directory-footer")?.append(btn);
});
