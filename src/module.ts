import { MODULE_ID } from "./constants";
import { registerSettings } from "./settings";
import { log } from "./utils/logger";
import { buildApi } from "./api/index";
import { HandoutPanel } from "./apps/handout-panel";
import { listVisibleViews, type HandoutView } from "./handout/handout-view";
import { buildFingerprint, diffReveals } from "./handout/reveal-detect";
import { isHandout } from "./handout/handout-flags";
import { reapplyOwnershipForActor } from "./handout/handout-repo";
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

  // 패널 반응성 초기화: 기준 지문을 먼저 잡고(패널 열림과 무관) 문서 변경 훅을 구독한다.
  lastFingerprint = buildFingerprint(listVisibleViews());
  Hooks.on("updateJournalEntry", onJournalMaybeHandout);
  Hooks.on("createJournalEntry", onJournalMaybeHandout);
  Hooks.on("deleteJournalEntry", onJournalMaybeHandout);
  Hooks.on("updateJournalEntryPage", onPageMaybeHandout);
  // 액터 삭제 시 열린 패널을 재렌더한다(쓰기 없음). 삭제된 액터가 공개 대상이던 핸드아웃의
  // 칩 카운트를 즉시 정직하게 갱신하기 위함 — 저장된 revealedTo 정리는 회수 액션이 담당한다.
  Hooks.on("deleteActor", reactToHandoutChange);
  Hooks.on("updateActor", onActorOwnershipChanged);
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

// 닫힘→열기: 포커스 예약 후 (없으면)강제 오픈. 첫 _onRender 가 포커스를 소비한다.
const openWithFocus = (ids: string[]): void => {
  panel ??= new HandoutPanel();
  panel.setPendingFocus(ids);
  if (panel.rendered) {
    panel.bringToFront?.();
    void panel.render();
  } else {
    void panel.render({ force: true });
  }
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

// ── 패널 반응성 ──────────────────────────────────────────────────────────
// 가시성 변경(applyFlagsUpdate)은 모든 클라이언트에 updateJournalEntry/Page 를 발화한다.
// ownership diff 를 직접 파싱하지 않고, "나에게 보이는 집합"을 재계산해 직전 지문과
// 비교한다(견고). 디바운스로 버스트(다중 공개)를 1회로 합친다. 어떤 쓰기도 하지 않는다.
let lastFingerprint = new Map<string, boolean>();
let reactTimer: number | null = null;

// 새 공개 토스트. 1건이면 이름 포함, N건이면 개수. 토스트 클릭 시 패널 열기(best-effort).
function notifyReveal(revealedIds: string[], views: HandoutView[]): void {
  const message =
    revealedIds.length === 1
      ? `새 핸드아웃이 공개되었습니다: ${views.find((v) => v.id === revealedIds[0])?.name || "핸드아웃"}`
      : `${revealedIds.length}개의 새 핸드아웃이 공개되었습니다`;
  const n = ui.notifications?.info(message);
  // 토스트 클릭으로 패널 열기. element 는 렌더 후 채워지므로(fvtt-types: HTMLLIElement?)
  // 다음 틱에 바인딩 시도한다. 미지원이어도 토스트 정보는 유지되고 Scene Control 로 열 수 있다.
  window.setTimeout(() => {
    n?.element?.addEventListener("click", () => openWithFocus(revealedIds));
  }, 100);
}

function reactToHandoutChange(): void {
  if (reactTimer !== null) clearTimeout(reactTimer);
  reactTimer = window.setTimeout(() => {
    reactTimer = null;
    const views = listVisibleViews();
    const next = buildFingerprint(views);
    const { revealedIds } = diffReveals(lastFingerprint, next);
    // ① 열린 패널: 새 공개가 있으면 포커스(스크롤+펼침+펄스), 없으면 단순 새로고침.
    if (panel?.rendered) {
      if (revealedIds.length > 0) panel.focusReveals(revealedIds);
      else void panel.render();
    }
    // ② 비-GM 에게만 새 공개 토스트
    if (!game.user?.isGM && revealedIds.length > 0) notifyReveal(revealedIds, views);
    lastFingerprint = next;
  }, 250);
}

// 훅 가드: 우리 핸드아웃 문서일 때만 반응.
function onJournalMaybeHandout(entry: JournalEntry): void {
  if (isHandout(entry)) reactToHandoutChange();
}
function onPageMaybeHandout(page: JournalEntryPage): void {
  const entry = page.parent;
  if (entry && isHandout(entry)) reactToHandoutChange();
}

// 액터 ownership 변경(예: 플레이어 OWNER 할당) 시, 그 액터에 의존하는 핸드아웃의 page ownership 을
// GM 클라이언트에서 재파생한다. write 결과는 updateJournalEntry(Page) 훅으로 연쇄돼 각 클라이언트가
// 재렌더/토스트한다(별도 배선 불필요). ownership 이 실제 바뀐 경우에만 반응(무관 편집 무시).
function onActorOwnershipChanged(actor: Actor, change: Record<string, unknown>): void {
  if (!game.user?.isGM) return;
  if (change.ownership === undefined) return;
  const id = actor.id;
  if (!id) return;
  void reapplyOwnershipForActor(id);
}

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
