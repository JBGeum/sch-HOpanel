import { MODULE_ID, SETTINGS } from "../constants";
import { getSetting, setSetting } from "../settings";
import { getHandoutDoc, listHandoutDocs, type HandoutDoc } from "../handout/handout-repo";
import { listVisibleViews, type HandoutView } from "../handout/handout-view";
import { filterViews, groupViewsByKind, aggregateFooter, collectTags } from "../handout/handout-filter";
import { parseTags } from "../handout/handout-create";
import { bodyToHtml, htmlToBody, isInlineEditable } from "../handout/body-text";
import { computeReorder } from "../handout/handout-order";
import type { Owner, SurfaceMode } from "../handout/reveal-state";
import type { HandoutKind } from "../handout/handout-flags";
import { log } from "../utils/logger";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Escape HTML special characters to prevent injection. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

/**
 * DialogV2 콜백 인자에서 루트 HTMLElement 를 얻는다.
 * fvtt-types 의 RenderCallback/ButtonCallback 시그니처는 element 를 노출하지 않으므로,
 * ApplicationV2 의 element(HTMLElement)로 좁히는 캐스트를 이 한 곳에 모은다.
 */
function dialogEl(dialog: unknown): HTMLElement {
  return (dialog as { element: HTMLElement }).element;
}

type DialogRender = foundry.applications.api.DialogV2.RenderCallback;

/**
 * DialogV2 config 에 네임스페이스 클래스(.sch-handout-panel/.shp-dialog)와
 * 현재 테마(data-theme)를 주입한다. 기존 render 가 있으면 먼저 실행한 뒤 data-theme 를 설정.
 * wait/confirm 양쪽에서 재사용(5개 다이얼로그 공통 테마 배선).
 * 반환 캐스트(as C): 스프레드+오버라이드 결과를 제네릭 C 로 좁히기 위함(필드는 모두 C 의 제약 내).
 */
function withDialogTheme<C extends { classes?: string[]; render?: DialogRender | null } & Record<string, unknown>>(config: C): C {
  const theme = (getSetting(SETTINGS.theme) as string) ?? "light";
  const prev = config.render ?? undefined;
  const render: DialogRender = (event, dialog) => {
    prev?.(event, dialog);
    dialogEl(dialog).dataset.theme = theme;
  };
  return {
    ...config,
    classes: [...(config.classes ?? []), "sch-handout-panel", "shp-dialog"],
    // 기본 다이얼로그 폭(개별 config.position 으로 override 가능).
    position: { width: 480, ...((config.position as Record<string, unknown>) ?? {}) },
    render,
  } as C;
}

/** 플레이어 소유 액터 목록 → <option> 문자열. selectedId 와 일치하는 option 에 selected. */
function buildActorOptions(pcs: Actor[], selectedId?: string): string {
  return pcs
    .map((a) => {
      const id = a.id ?? "";
      const sel = selectedId !== undefined && id === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(a.name ?? "(알 수 없음)")}</option>`;
    })
    .join("");
}


type PanelRow = HandoutView & { expanded: boolean };

interface PanelContext extends foundry.applications.api.ApplicationV2.RenderContext {
  theme: string;
  isDark: boolean;
  isGM: boolean;
  view: "list" | "group";
  reorderable: boolean;
  query: string;
  activeTag: string;
  categories: { key: string; label: string; active: boolean }[];
  count: number;
  rows: PanelRow[];
  groups: { kind: HandoutKind; label: string; rows: PanelRow[] }[] | null;
  footer: { total: number; pc: number; floating: number; pending: number };
}

/** 생성 다이얼로그 ok 콜백이 dialog.element 에서 수집해 반환하는 폼 값. */
interface CreateFormResult {
  kind: HandoutKind;
  actorId: string;
  surface: string;
  secret: string;
  tags: string;
  name: string;
}

/** 편집 다이얼로그 ok 콜백이 dialog.element 에서 수집해 반환하는 폼 값. 본문은 인라인 편집 가능한 경우에만 포함(absent = 변경 안 함). */
interface EditFormResult {
  kind: HandoutKind;
  actorId: string;
  tags: string;
  name: string;
  surface?: string;
  secret?: string;
}

export class HandoutPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  #expanded = new Set<string>();
  /** Cached handout count from the last _prepareContext call; used by the title getter. */
  #lastCount = 0;
  #query = "";
  #activeTag = "";
  #view: "list" | "group" = "list";
  /** 검색으로 인한 재렌더 직후에만 input 포커스·캐럿을 복원한다(다른 액션 렌더는 제외). 일회성 플래그. */
  #restoreSearch = false;
  /** 재렌더 직전 캐럿 위치(input 재생성 후 같은 자리로 복원). */
  #searchCaret: number | null = null;
  /** 검색 재렌더 디바운스 타이머. 매 키 입력마다 전체 재렌더하면 input 이 재생성돼 IME 조합·캐럿이 깨지므로, 타이핑이 멈춘 뒤에만 렌더한다. */
  #searchTimer: number | null = null;
  /** IME 조합 중 여부. 조합 중에는 재렌더하지 않는다(한글 자모 조합 보호). */
  #composing = false;
  /** 다음 렌더에서 스크롤·강조할 핸드아웃 id(일회성). null 이면 포커스 동작 없음. */
  #focusScrollId: string | null = null;
  /** 다음 렌더에서 .shp-row--flash 를 줄 핸드아웃 id 집합(일회성). */
  #focusFlash = new Set<string>();

  static override DEFAULT_OPTIONS: foundry.applications.api.ApplicationV2.DefaultOptions = {
    id: "sch-handout-panel",
    classes: ["sch-handout-panel"],
    tag: "div",
    window: { title: "SCH.Panel.Title", icon: "fa-solid fa-scroll" },
    position: { width: 520, height: "auto" as const },
    actions: {
      "toggle-theme": HandoutPanel._onToggleTheme,
      "toggle-expand": HandoutPanel._onToggleExpand,
      reveal: HandoutPanel._onReveal,
      "open-sheet": HandoutPanel._onOpenSheet,
      create: HandoutPanel._onCreate,
      edit: HandoutPanel._onEdit,
      delete: HandoutPanel._onDelete,
      "surface-vis": HandoutPanel._onSurfaceVis,
      retract: HandoutPanel._onRetract,
      filter: HandoutPanel._onFilter,
      "set-view": HandoutPanel._onSetView,
      share: HandoutPanel._onShare,
    },
  };

  /**
   * Dynamic window title showing the current handout count.
   * ApplicationV2 reads this.title when building the window frame title element.
   * We cache #lastCount in _prepareContext so the getter stays synchronous.
   */
  override get title(): string {
    const base = game.i18n.localize("SCH.Panel.Title");
    return `${base} (${this.#lastCount})`;
  }

  /**
   * Expose the theme-toggle as a header control so it appears in the native
   * window controls dropdown (the ⚙ button in the window header).
   * The `action` string maps to the "toggle-theme" key in DEFAULT_OPTIONS.actions.
   */
  protected override _getHeaderControls(): foundry.applications.api.ApplicationV2.HeaderControlsEntry[] {
    const controls = super._getHeaderControls();
    const theme = (getSetting(SETTINGS.theme) as string) ?? "light";
    const isDark = theme === "dark";
    controls.unshift({
      icon: isDark ? "fa-solid fa-sun" : "fa-solid fa-moon",
      label: isDark ? "SCH.Panel.ThemeLight" : "SCH.Panel.ThemeDark",
      action: "toggle-theme",
    });
    return controls;
  }

  static override PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/handout-panel.hbs` },
  };

  override async _prepareContext(
    options: foundry.applications.api.ApplicationV2.RenderOptions & { isFirstRender: boolean },
  ): Promise<PanelContext> {
    const base = await super._prepareContext(options);
    const theme = (getSetting(SETTINGS.theme) as string) ?? "light";

    // 보이는 집합 계산은 listVisibleViews 단일 출처(반응성 핸들러와 공유).
    const visible = listVisibleViews();

    const filtered = filterViews(visible, { query: this.#query, tag: this.#activeTag });
    const rows: PanelRow[] = filtered.map((v) => ({ ...v, expanded: this.#expanded.has(v.id) }));
    const groups = this.#view === "group" ? groupViewsByKind(rows) : null;
    const footer = aggregateFooter(rows);
    const categories = [
      { key: "", label: "전체" },
      ...collectTags(visible).map((t) => ({ key: t, label: t })),
    ].map((c) => ({ ...c, active: c.key === this.#activeTag }));

    // 드래그 재정렬 가능 조건: GM 이고, 부분 목록 모호성을 피하기 위해 필터·검색이 모두 비활성일 때만.
    const reorderable =
      (game.user?.isGM ?? false) && this.#query === "" && this.#activeTag === "";

    // Cache count so the synchronous title getter can read it without re-querying.
    this.#lastCount = rows.length;

    return {
      ...base,
      theme,
      isDark: theme === "dark",
      isGM: game.user?.isGM ?? false,
      view: this.#view,
      reorderable,
      query: this.#query,
      activeTag: this.#activeTag,
      categories,
      count: rows.length,
      rows,
      groups,
      footer,
    };
  }

  /**
   * After each render, stamp data-theme on the app ROOT element so that
   * _themes.scss (:where(.sch-handout-panel)[data-theme=...]) matches the root
   * and cascades --shp-* variables into the native .window-header sibling.
   */
  protected override async _onRender(
    _context: foundry.applications.api.ApplicationV2.RenderContext,
    _options: foundry.applications.api.ApplicationV2.RenderOptions,
  ): Promise<void> {
    const theme = (getSetting(SETTINGS.theme) as string) ?? "light";
    this.element.dataset.theme = theme;
    // 폰트 배율(%) → 본문 줌 변수. _panel.scss 의 .shp-panel { zoom: var(--shp-zoom) } 가 소비한다.
    const fontScale = (getSetting(SETTINGS.fontScale) as number) ?? 100;
    this.element.style.setProperty("--shp-zoom", String(fontScale / 100));
    const search = this.element.querySelector<HTMLInputElement>('input[name="q"]');
    if (search) {
      // 타이핑이 멈춘 뒤에만 재렌더(디바운스). 조합 중이면 미뤘다 끝나고 렌더.
      // 렌더 직전 캐럿 위치를 저장하고 일회성 복원 플래그를 세운다.
      const scheduleRender = (): void => {
        if (this.#searchTimer !== null) clearTimeout(this.#searchTimer);
        this.#searchTimer = window.setTimeout(() => {
          this.#searchTimer = null;
          if (this.#composing) {
            scheduleRender();
            return;
          }
          this.#searchCaret = search.selectionStart;
          this.#restoreSearch = true;
          void this.render();
        }, 200);
      };
      search.addEventListener("compositionstart", () => {
        this.#composing = true;
      });
      search.addEventListener("compositionend", () => {
        this.#composing = false;
        this.#query = search.value;
        scheduleRender();
      });
      search.addEventListener("input", () => {
        // IME 조합 중 input 은 무시(compositionend 에서 확정 반영) → 조합 깨짐 방지.
        if (this.#composing) return;
        this.#query = search.value;
        scheduleRender();
      });
      // 검색으로 인한 재렌더 직후에만 포커스·캐럿을 같은 자리로 복원(다른 액션 렌더는 제외).
      // input 재생성 시 발생하는 blur 와 무관한 일회성 플래그라, 캐럿이 맨 앞으로 튀지 않는다.
      if (this.#restoreSearch) {
        this.#restoreSearch = false;
        search.focus();
        const pos = this.#searchCaret ?? search.value.length;
        const clamped = Math.min(Math.max(pos, 0), search.value.length);
        search.setSelectionRange(clamped, clamped);
      }
    }

    // 공개 포커스(일회성): 예약된 핸드아웃으로 스크롤 + 강조 펄스.
    // 검색/액션 렌더에는 #focusScrollId 가 null 이라 미발동.
    if (this.#focusScrollId !== null) {
      const targetId = this.#focusScrollId;
      const flashIds = this.#focusFlash;
      this.#focusScrollId = null;
      this.#focusFlash = new Set();

      const row = this.element.querySelector<HTMLElement>(`.shp-row[data-handout-id="${targetId}"]`);
      // 필터/검색으로 가려져 DOM 에 없으면 포커스 생략.
      if (row) {
        row.scrollIntoView({ block: "nearest" });
        for (const id of flashIds) {
          const el = this.element.querySelector<HTMLElement>(`.shp-row[data-handout-id="${id}"]`);
          if (!el) continue;
          el.classList.add("shp-row--flash");
          window.setTimeout(() => el.classList.remove("shp-row--flash"), 1500);
        }
      }
    }

    // ── 드래그 재정렬 ──────────────────────────────────────────────
    // 핸들은 reorderable(GM·무필터·무검색)일 때만 렌더된다. 핸들만 draggable 이고,
    // 행 전체가 드롭 타겟. 재렌더는 reorderHandouts → updateJournalEntry 반응성 훅이 담당.
    const handles = this.element.querySelectorAll<HTMLElement>(".shp-row__drag");
    if (handles.length > 0) {
      let draggedId: string | null = null;
      let draggedKind: string | undefined;

      const clearIndicators = (): void => {
        this.element
          .querySelectorAll(".shp-row--drop-before, .shp-row--drop-after")
          .forEach((el) => el.classList.remove("shp-row--drop-before", "shp-row--drop-after"));
      };

      handles.forEach((handle) => {
        const row = handle.closest<HTMLElement>(".shp-row");
        if (!row) return;
        // 핸들 클릭(드래그 아님)이 head 의 toggle-expand 로 버블링되지 않게 차단.
        handle.addEventListener("click", (ev) => ev.stopPropagation());
        handle.addEventListener("dragstart", (ev: DragEvent) => {
          draggedId = row.dataset.handoutId ?? null;
          draggedKind = row.dataset.kind;
          if (ev.dataTransfer && draggedId) {
            ev.dataTransfer.setData("text/plain", draggedId);
            ev.dataTransfer.effectAllowed = "move";
          }
          row.classList.add("shp-row--dragging");
        });
        handle.addEventListener("dragend", () => {
          draggedId = null;
          draggedKind = undefined;
          row.classList.remove("shp-row--dragging");
          clearIndicators();
        });
      });

      this.element.querySelectorAll<HTMLElement>(".shp-row").forEach((row) => {
        row.addEventListener("dragover", (ev: DragEvent) => {
          if (!draggedId) return;
          const targetId = row.dataset.handoutId;
          if (!targetId || targetId === draggedId) { clearIndicators(); return; }
          // group 보기에서는 동종 kind 그룹 내에서만 허용(cross-group 드롭 금지).
          if (this.#view === "group" && draggedKind !== undefined && row.dataset.kind !== draggedKind) {
            if (ev.dataTransfer) ev.dataTransfer.dropEffect = "none";
            clearIndicators();
            return; // preventDefault 생략 → 드롭 불가
          }
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
          const rect = row.getBoundingClientRect();
          const after = ev.clientY > rect.top + rect.height / 2;
          clearIndicators();
          row.classList.add(after ? "shp-row--drop-after" : "shp-row--drop-before");
        });
        row.addEventListener("drop", (ev: DragEvent) => {
          if (!draggedId) return;
          const targetId = row.dataset.handoutId;
          if (!targetId || targetId === draggedId) {
            clearIndicators();
            return;
          }
          if (this.#view === "group" && draggedKind !== undefined && row.dataset.kind !== draggedKind) {
            clearIndicators();
            return;
          }
          ev.preventDefault();
          const rect = row.getBoundingClientRect();
          const pos: "before" | "after" =
            ev.clientY > rect.top + rect.height / 2 ? "after" : "before";
          const moved = draggedId;
          clearIndicators();
          void HandoutPanel._applyReorder(moved, targetId, pos);
        });
        row.addEventListener("dragleave", () => {
          row.classList.remove("shp-row--drop-before", "shp-row--drop-after");
        });
      });
    }
  }

  /**
   * 다음 렌더에서 포커스할 핸드아웃을 예약한다(렌더는 하지 않음).
   * 전부 펼치고(#expanded), 첫 id 를 스크롤 기준으로, 전부를 강조 대상으로 잡는다.
   * 열린 패널(focusReveals)과 닫힘→열기(module.openWithFocus)가 공유한다.
   */
  setPendingFocus(ids: string[]): void {
    if (ids.length === 0) return;
    for (const id of ids) this.#expanded.add(id);
    this.#focusScrollId = ids[0];
    this.#focusFlash = new Set(ids);
  }

  /** 열린 패널용: 포커스 예약 후 즉시 재렌더. */
  focusReveals(ids: string[]): void {
    this.setPendingFocus(ids);
    void this.render();
  }

  /**
   * 패널이 닫힐 때 우리 scene control 이 여전히 활성 상태이면 기본 컨트롤(tokens)로
   * 되돌려 비활성화한다. V13 scene control 은 "이미 활성인 컨트롤"을 재클릭해도
   * active 전이가 없어 onChange 를 발화하지 않는다 → 닫은 뒤 같은 버튼을 다시 눌러도
   * 재오픈되지 않는다. 닫힘 시 비활성화해 두면 다음 클릭이 false→true 전이를 만들어
   * onChange 가 정상 발화하고 패널이 다시 열린다.
   */
  protected override _onClose(options: foundry.applications.api.ApplicationV2.RenderOptions): void {
    super._onClose(options);
    const controls = ui.controls;
    if (controls?.control?.name === MODULE_ID) void controls.activate({ control: "tokens" });
  }

  /** Used as action handler for "toggle-theme". Protected prefix so it's accessible from DEFAULT_OPTIONS. */
  protected static async _onToggleTheme(this: HandoutPanel): Promise<void> {
    const next = ((getSetting(SETTINGS.theme) as string) ?? "light") === "light" ? "dark" : "light";
    await setSetting(SETTINGS.theme, next);
    // Re-render with controls:true so the header controls dropdown icon updates (sun↔moon).
    void this.render({ window: { controls: true } });
  }

  /** 카테고리 단일 필터 토글(전체 key=""). 같은 칩 재클릭은 해제. */
  protected static _onFilter(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): void {
    const tag = target.dataset.filter ?? "";
    this.#activeTag = this.#activeTag === tag ? "" : tag;
    void this.render();
  }

  /** 보기 토글(list/group). */
  protected static _onSetView(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): void {
    const v = target.dataset.viewSet;
    if (v === "list" || v === "group") this.#view = v;
    void this.render();
  }

  /**
   * 드롭 결과를 적용한다(GM 전용 경로). repo 에서 현재 정렬된 전체 docs 를 읽어
   * (id, order) 시퀀스를 만들고 computeReorder 로 변경분만 산출 → 공개 API 로 persist.
   * GM 의 listHandoutDocs 는 hidden 포함 전체 핸드아웃이라 전역 order 시퀀스와 동치.
   * 재렌더는 updateJournalEntry 반응성 훅이 담당(여기서 render 호출 안 함).
   */
  protected static async _applyReorder(
    movedId: string,
    targetId: string,
    pos: "before" | "after",
  ): Promise<void> {
    const docs = listHandoutDocs();
    const items = docs.map((d) => ({ id: d.entry.id ?? "", order: d.flags.order }));
    const updates = computeReorder(items, movedId, targetId, pos);
    if (updates.length === 0) return;
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.reorderHandouts(updates);
    log.info("reorderHandouts requested", updates.length);
  }

  protected static _onToggleExpand(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): void {
    const id = target.closest<HTMLElement>("[data-handout-id]")?.dataset.handoutId;
    if (!id) return;
    if (this.#expanded.has(id)) this.#expanded.delete(id);
    else this.#expanded.add(id);
    void this.render();
  }

  protected static async _onOpenSheet(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    const doc = id ? getHandoutDoc(id) : null;
    // Cast rationale: sheet is typed as FormApplication.Any | ApplicationV2.Any | null.
    // Both support the legacy boolean render(true) overload for force-open; using that
    // avoids the incompatibility between AppV1 render(force: boolean) and AppV2 render(opts: object).
    (doc?.entry.sheet as { render: (force: boolean) => void } | null | undefined)?.render(true);
  }

  protected static async _onReveal(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    const doc = id ? getHandoutDoc(id) : null;
    if (!doc) return;
    await HandoutPanel._openRevealDialog(doc.entry.id ?? "", doc.flags.revealState.secret.revealedTo);
    void this.render();
  }

  /**
   * 비밀 회수(GM 전용 액션). 공개의 역방향.
   * all(전원공개) → 확인 후 전체 회수(→비공개). limited → 대상 선택 다이얼로그(체크=회수).
   * owner → 회수 대상 없음(no-op 안전망; 버튼이 안 떠야 정상).
   */
  protected static async _onRetract(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    if (!id) return;
    const doc = getHandoutDoc(id);
    if (!doc) return;
    const secret = doc.flags.revealState.secret;
    const api = game.modules.get(MODULE_ID)?.api;
    if (secret.mode === "all") {
      const confirmed = await DialogV2.confirm(withDialogTheme({
        window: { title: "비밀 회수" },
        content: `<div class="shp-dialog-body shp-dialog-body--message">전원공개를 회수하여 비공개로 전환합니다. <span class="shp-detail__hint">이미 본 내용은 되돌릴 수 없습니다.</span></div>`,
        yes: { label: "회수", class: "shp-dbtn shp-dbtn--danger" },
        no: { label: "취소", class: "shp-dbtn" },
        rejectClose: false,
      }));
      if (!confirmed) return;
      await api?.retractSecret(id, []);
    } else if (secret.mode === "limited") {
      const selected = await HandoutPanel._openRetractDialog(secret.revealedTo);
      if (selected === null || selected.length === 0) return; // 취소/빈 선택
      await api?.retractSecret(id, selected);
    } else {
      return; // owner — no-op
    }
    log.info("retractSecret requested", id);
    void this.render();
  }

  /**
   * 채팅 게시(GM 전용). area=surface 는 바로, secret 은 확인 후 전체 공개 게시.
   * 채팅에만 영향 → 패널 재렌더 없음.
   */
  protected static async _onShare(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    const area = target.dataset.area as "surface" | "secret" | undefined;
    if (!id || (area !== "surface" && area !== "secret")) return;
    const api = game.modules.get(MODULE_ID)?.api;
    if (area === "secret") {
      const confirmed = await DialogV2.confirm(withDialogTheme({
        window: { title: "비밀 채팅 게시" },
        content: `<div class="shp-dialog-body shp-dialog-body--message">비밀 내용을 전체 채팅에 공개합니다. <b class="shp-warn">되돌릴 수 없습니다.</b></div>`,
        yes: { label: "게시", class: "shp-dbtn shp-dbtn--danger" },
        no: { label: "취소", class: "shp-dbtn" },
        rejectClose: false,
      }));
      if (!confirmed) return;
    }
    await api?.shareToChat(id, area);
    log.info("shareToChat requested", id, area);
  }

  /**
   * 삭제 확인 다이얼로그(DialogV2.confirm) → 확인 시 공개 API 로 삭제 → 재렌더.
   * entry.delete() 는 되돌릴 수 없으므로 1단계 확인 필수(회수와 달리 데이터 자체 제거).
   */
  protected static async _onDelete(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    if (!id) return;
    const confirmed = await DialogV2.confirm(withDialogTheme({
      window: { title: "핸드아웃 삭제" },
      content: `<div class="shp-dialog-body shp-dialog-body--message">이 핸드아웃을 삭제합니다. <b class="shp-warn">되돌릴 수 없습니다.</b></div>`,
      yes: { label: "예", class: "shp-dbtn shp-dbtn--danger" },
      no: { label: "아니오", class: "shp-dbtn shp-dbtn--danger-ghost" },
      rejectClose: false,
    }));
    if (!confirmed) return;
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.deleteHandout(id);
    void this.render();
  }

  /**
   * 생성 다이얼로그를 열고, 취소가 아니면 태그를 정규화한 뒤 공개 API 로 생성 → 재렌더.
   * owner 는 kind 에 따라 actor/gm 분기. 권한 로직은 추가하지 않고 createHandout 에 위임.
   */
  protected static async _onCreate(this: HandoutPanel): Promise<void> {
    const result = await HandoutPanel._openCreateDialog();
    if (!result) return;
    const tags = parseTags(result.tags);
    const owner: Owner =
      result.kind === "pc" ? { kind: "actor", actorId: result.actorId } : { kind: "gm" };
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.createHandout({
      owner,
      kind: result.kind,
      tags,
      surface: bodyToHtml(result.surface),
      secret: bodyToHtml(result.secret),
      name: result.name,
    });
    log.info("createHandout requested", owner, tags);
    void this.render();
  }

  /**
   * 생성 폼 다이얼로그(DialogV2.wait). _openRevealDialog 와 동일 패턴:
   * ok 콜백이 dialog.element 에서 값을 직접 수집해 객체로 반환한다.
   * 플레이어 소유 액터가 0개면 PC 라디오 비활성·기본 떠도는·actorId 행 숨김 →
   * 항상 유효한 기본 상태이므로 폼 검증/재오픈이 불필요(리스크 §11 검증 단순화).
   */
  protected static async _openCreateDialog(): Promise<CreateFormResult | null> {
    const pcs = Array.from((game.actors ?? []) as Iterable<Actor>).filter((a) => a.hasPlayerOwner);
    const hasPc = pcs.length > 0;

    const actorOptions = buildActorOptions(pcs);

    const pcAttrs = hasPc ? "checked" : "disabled";
    const floatingAttrs = hasPc ? "" : "checked";
    const actorRowStyle = hasPc ? "" : "display:none";

    const content = `
      <div class="shp-dialog-body">
        <div class="shp-field"><div class="shp-field__label">이름</div><input class="shp-input" type="text" name="title" placeholder="핸드아웃 이름"></div>
        <fieldset class="shp-fieldset">
          <legend>종류</legend>
          <div class="shp-fieldset__opts">
            <label class="shp-radio"><input type="radio" name="kind" value="pc" ${pcAttrs}><span class="shp-radio__box"></span> PC</label>
            <label class="shp-radio"><input type="radio" name="kind" value="floating" ${floatingAttrs}><span class="shp-radio__box"></span> 공용</label>
          </div>
        </fieldset>
        <div class="shp-field sch-create-actor" style="${actorRowStyle}">
          <div class="shp-field__label">소유자 액터</div>
          <select class="shp-select" name="actorId">${actorOptions}</select>
        </div>
        <div class="shp-field"><div class="shp-field__label">앞면</div><textarea class="shp-textarea" name="surface" rows="3"></textarea></div>
        <div class="shp-field"><div class="shp-field__label">비밀</div><textarea class="shp-textarea" name="secret" rows="3"></textarea></div>
        <div class="shp-field"><div class="shp-field__label">태그<em>(쉼표 구분)</em></div><input class="shp-input" type="text" name="tags"></div>
      </div>`;

    const result = await DialogV2.wait(withDialogTheme({
      window: { title: "핸드아웃 생성" },
      content,
      rejectClose: false,
      render: (_event, dialog) => {
        const el = dialogEl(dialog);
        const actorRow = el.querySelector<HTMLElement>(".sch-create-actor");
        el.querySelectorAll<HTMLInputElement>('input[name="kind"]').forEach((radio) => {
          radio.addEventListener("change", () => {
            const isPc =
              el.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value === "pc";
            if (actorRow) actorRow.style.display = isPc ? "" : "none";
          });
        });
      },
      buttons: [
        {
          action: "ok",
          label: "생성",
          icon: "fa-solid fa-check",
          class: "shp-dbtn shp-dbtn--primary",
          default: true,
          callback: (
            _event: PointerEvent | SubmitEvent,
            _button: HTMLButtonElement,
            dialog: foundry.applications.api.DialogV2.Any,
          ) => {
            const el = dialogEl(dialog);
            const kind = (el.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value ??
              "floating") as HandoutKind;
            const actorId = el.querySelector<HTMLSelectElement>('select[name="actorId"]')?.value ?? "";
            const surface = el.querySelector<HTMLTextAreaElement>('textarea[name="surface"]')?.value ?? "";
            const secret = el.querySelector<HTMLTextAreaElement>('textarea[name="secret"]')?.value ?? "";
            const tags = el.querySelector<HTMLInputElement>('input[name="tags"]')?.value ?? "";
            const name = el.querySelector<HTMLInputElement>('input[name="title"]')?.value ?? "";
            const out: CreateFormResult = { kind, actorId, surface, secret, tags, name };
            return out;
          },
        },
        { action: "cancel", label: "취소", icon: "fa-solid fa-xmark", class: "shp-dbtn" },
      ],
    }));

    // result: CreateFormResult(ok) | "cancel"(취소) | null(dismiss)
    if (!result || typeof result === "string") return null;
    return result as CreateFormResult;
  }

  /**
   * 편집 다이얼로그를 열고, 취소가 아니면 태그를 정규화한 뒤 공개 API 로 메타 갱신 → 재렌더.
   * owner 는 kind 에 따라 actor/gm 분기. ownership 재파생은 updateHandoutMeta→applyFlagsUpdate 가 담당.
   */
  protected static async _onEdit(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    if (!id) return;
    const doc = getHandoutDoc(id);
    if (!doc) return;
    const result = await HandoutPanel._openEditDialog(doc);
    if (!result) return;
    const tags = parseTags(result.tags);
    const owner: Owner =
      result.kind === "pc" ? { kind: "actor", actorId: result.actorId } : { kind: "gm" };
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.updateHandoutMeta(id, { owner, kind: result.kind, tags, name: result.name });
    // 인라인 편집된 본문만(정의된 키만) HTML 로 변환해 저장. 둘 다 없으면 호출 생략.
    const body: { surface?: string; secret?: string } = {};
    if (result.surface !== undefined) body.surface = bodyToHtml(result.surface);
    if (result.secret !== undefined) body.secret = bodyToHtml(result.secret);
    if (body.surface !== undefined || body.secret !== undefined)
      await api?.updateHandoutBody(id, body);
    log.info("updateHandoutMeta requested", id, owner, tags);
    void this.render();
  }

  /**
   * 앞면 가시성 세그먼트(GM 전용 액션). 현재 mode 재클릭은 no-op.
   * all/hidden 은 즉시 적용(가역이라 확인 다이얼로그 없음, revealedTo 보존).
   * limited 는 대상 액터 다이얼로그를 거쳐 선택 명단으로 교체(replace, 빈 선택도 유효).
   */
  protected static async _onSurfaceVis(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    const mode = target.dataset.mode as SurfaceMode | undefined;
    if (!id || !mode) return;
    const doc = getHandoutDoc(id);
    if (!doc) return;
    const cur = doc.flags.revealState.surface;
    if (mode === cur.mode) return; // 현재 상태 재클릭 → no-op
    const api = game.modules.get(MODULE_ID)?.api;
    if (mode === "limited") {
      const selected = await HandoutPanel._openSurfaceLimitDialog(cur.revealedTo);
      if (selected === null) return; // 취소/dismiss
      await api?.setSurfaceVisibility(id, { mode: "limited", revealedTo: selected });
    } else {
      // all | hidden — 즉시, 확인 없음, 기존 revealedTo 보존
      await api?.setSurfaceVisibility(id, { mode, revealedTo: cur.revealedTo });
    }
    log.info("setSurfaceVisibility requested", id, mode);
    void this.render();
  }

  /**
   * 편집 폼 다이얼로그(DialogV2.wait). 생성 다이얼로그와 동일 구조이되 본문(앞면/비밀) 없음 +
   * 현재값 prefill: kind 라디오 체크, actorId select 선택, 태그는 자유 입력(쉼표 구분)으로 prefill.
   * 0-액터 처리(pc 비활성·기본 떠도는)·동적 토글·escapeHtml 은 생성과 동일.
   */
  protected static async _openEditDialog(doc: HandoutDoc): Promise<EditFormResult | null> {
    const pcs = Array.from((game.actors ?? []) as Iterable<Actor>).filter((a) => a.hasPlayerOwner);
    const hasPc = pcs.length > 0;
    const tagsValue = doc.flags.tags.join(", ");
    const currentKind = doc.flags.kind;
    const currentActorId = doc.flags.owner.actorId;

    // prefill + 0-액터 처리: pc 는 hasPc 없으면 비활성, 현재 kind 에 따라 checked.
    const pcDisabled = hasPc ? "" : " disabled";
    const pcChecked = currentKind === "pc" && hasPc ? " checked" : "";
    const floatingChecked = currentKind === "floating" || !hasPc ? " checked" : "";
    const showActor = currentKind === "pc" && hasPc;
    const actorRowStyle = showActor ? "" : "display:none";

    const surfaceContent = doc.surfacePage?.text?.content ?? "";
    const secretContent = doc.secretPage?.text?.content ?? "";
    // 평문이면 textarea(현재값 prefill), 리치(<br> 외 태그)면 잠금 안내 → "시트 열기" 유도.
    const bodyField = (label: string, name: string, content: string): string =>
      isInlineEditable(content)
        ? `<div class="shp-field"><div class="shp-field__label">${label}</div><textarea class="shp-textarea" name="${name}" rows="4">${escapeHtml(htmlToBody(content))}</textarea></div>`
        : `<div class="shp-field"><div class="shp-field__label">${label}</div><div class="shp-locked-note">서식이 있는 본문입니다. '시트 열기'에서 편집하세요.</div></div>`;

    const content = `
      <div class="shp-dialog-body">
        <div class="shp-field"><div class="shp-field__label">이름</div><input class="shp-input" type="text" name="title" value="${escapeHtml(doc.entry.name ?? "")}"></div>
        <fieldset class="shp-fieldset">
          <legend>종류</legend>
          <div class="shp-fieldset__opts">
            <label class="shp-radio"><input type="radio" name="kind" value="pc"${pcChecked}${pcDisabled}><span class="shp-radio__box"></span> PC</label>
            <label class="shp-radio"><input type="radio" name="kind" value="floating"${floatingChecked}><span class="shp-radio__box"></span> 공용</label>
          </div>
        </fieldset>
        <div class="shp-field sch-edit-actor" style="${actorRowStyle}">
          <div class="shp-field__label">소유자 액터</div>
          <select class="shp-select" name="actorId">${buildActorOptions(pcs, currentActorId)}</select>
        </div>
        ${bodyField("앞면", "surface", surfaceContent)}
        ${bodyField("비밀", "secret", secretContent)}
        <div class="shp-field"><div class="shp-field__label">태그<em>(쉼표 구분)</em></div><input class="shp-input" type="text" name="tags" value="${escapeHtml(tagsValue)}"></div>
      </div>`;

    const result = await DialogV2.wait(withDialogTheme({
      window: { title: "핸드아웃 편집" },
      content,
      rejectClose: false,
      render: (_event, dialog) => {
        const el = dialogEl(dialog);
        const actorRow = el.querySelector<HTMLElement>(".sch-edit-actor");
        el.querySelectorAll<HTMLInputElement>('input[name="kind"]').forEach((radio) => {
          radio.addEventListener("change", () => {
            const isPc =
              el.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value === "pc";
            if (actorRow) actorRow.style.display = isPc ? "" : "none";
          });
        });
      },
      buttons: [
        {
          action: "ok",
          label: "저장",
          icon: "fa-solid fa-check",
          class: "shp-dbtn shp-dbtn--primary",
          default: true,
          callback: (
            _event: PointerEvent | SubmitEvent,
            _button: HTMLButtonElement,
            dialog: foundry.applications.api.DialogV2.Any,
          ) => {
            const el = dialogEl(dialog);
            const kind = (el.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value ??
              "floating") as HandoutKind;
            const actorId = el.querySelector<HTMLSelectElement>('select[name="actorId"]')?.value ?? "";
            const tags = el.querySelector<HTMLInputElement>('input[name="tags"]')?.value ?? "";
            const name = el.querySelector<HTMLInputElement>('input[name="title"]')?.value ?? "";
            // textarea 가 있으면(=평문이라 인라인 편집 허용) 값 수집, 없으면(리치) 키 자체를 빼서 변경하지 않음.
            const surfaceEl = el.querySelector<HTMLTextAreaElement>('textarea[name="surface"]');
            const secretEl = el.querySelector<HTMLTextAreaElement>('textarea[name="secret"]');
            const out: EditFormResult = {
              kind,
              actorId,
              tags,
              name,
              ...(surfaceEl ? { surface: surfaceEl.value } : {}),
              ...(secretEl ? { secret: secretEl.value } : {}),
            };
            return out;
          },
        },
        { action: "cancel", label: "취소", icon: "fa-solid fa-xmark", class: "shp-dbtn" },
      ],
    }));

    if (!result || typeof result === "string") return null;
    return result as EditFormResult;
  }

  /**
   * 앞면 limited 대상 선택 다이얼로그. _openRevealDialog 와 동형이되 교체(replace) 의미론:
   * 현재 revealedTo 는 checked 로 prefill 하되 disabled 아님(해제 가능). 빈 선택도 유효(일부 0).
   * 반환: 선택된 actorId[](교체 대상 전체, 빈 배열 포함) | null(취소/dismiss).
   */
  protected static async _openSurfaceLimitDialog(current: string[]): Promise<string[] | null> {
    const pcs = Array.from((game.actors ?? []) as Iterable<Actor>).filter((a) => a.hasPlayerOwner);
    const checks = pcs
      .map((a) => {
        const checked = current.includes(a.id ?? "") ? " checked" : "";
        return `<label class="shp-check"><input type="checkbox" name="actor" value="${escapeHtml(a.id ?? "")}"${checked}><span class="shp-check__box"></span> ${escapeHtml(a.name ?? "(알 수 없음)")}</label>`;
      })
      .join("");

    const content = `<div class="shp-dialog-body"><p>앞면을 볼 대상을 선택하세요.</p><div class="shp-checklist">${checks}</div></div>`;

    const selected = await DialogV2.wait(withDialogTheme({
      window: { title: "앞면 가시성 — 일부" },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "ok",
          label: "적용",
          icon: "fa-solid fa-check",
          class: "shp-dbtn shp-dbtn--primary",
          default: true,
          callback: (
            _event: PointerEvent | SubmitEvent,
            _button: HTMLButtonElement,
            dialog: foundry.applications.api.DialogV2.Any,
          ) => {
            const dlgEl = dialogEl(dialog);
            return Array.from(
              dlgEl.querySelectorAll<HTMLInputElement>('input[name="actor"]:checked'),
            ).map((el) => el.value);
          },
        },
        { action: "cancel", label: "취소", icon: "fa-solid fa-xmark", class: "shp-dbtn" },
      ],
    }));

    // selected: string[](ok, 빈 배열 가능) | "cancel"/"close"/null(dismiss)
    if (!Array.isArray(selected)) return null;
    return selected;
  }

  /**
   * 비밀 회수 대상 선택 다이얼로그(limited 모드). 후보 = 현재 공개 대상 액터(revealedTo).
   * 기본 미체크 — 체크한 것이 회수 대상. 반환: 회수할 actorId[](빈 배열 가능) | null(취소/dismiss).
   */
  protected static async _openRetractDialog(revealedActorIds: string[]): Promise<string[] | null> {
    const actors = Array.from((game.actors ?? []) as Iterable<Actor>).filter(
      (a) => revealedActorIds.includes(a.id ?? ""),
    );
    const checks = actors
      .map((a) =>
        `<label class="shp-check"><input type="checkbox" name="actor" value="${escapeHtml(a.id ?? "")}"><span class="shp-check__box"></span> ${escapeHtml(a.name ?? "(알 수 없음)")}</label>`,
      )
      .join("");

    const content = `<div class="shp-dialog-body"><p>회수할 대상을 선택하세요. <span class="shp-detail__hint">이미 본 내용은 되돌릴 수 없습니다.</span></p><div class="shp-checklist">${checks}</div></div>`;

    const selected = await DialogV2.wait(withDialogTheme({
      window: { title: "비밀 회수" },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "ok",
          label: "회수",
          icon: "fa-solid fa-rotate-left",
          class: "shp-dbtn shp-dbtn--danger",
          default: true,
          callback: (
            _event: PointerEvent | SubmitEvent,
            _button: HTMLButtonElement,
            dialog: foundry.applications.api.DialogV2.Any,
          ) => {
            const dlgEl = dialogEl(dialog);
            return Array.from(
              dlgEl.querySelectorAll<HTMLInputElement>('input[name="actor"]:checked'),
            ).map((el) => el.value);
          },
        },
        { action: "cancel", label: "취소", icon: "fa-solid fa-xmark", class: "shp-dbtn" },
      ],
    }));

    if (!Array.isArray(selected)) return null;
    return selected;
  }

  /**
   * Opens the reveal dialog using DialogV2.wait with an ok button callback that reads checked actors
   * directly from dialog.element. This avoids the fragile global-DOM-collect approach of DialogV2.confirm.
   * The callback receives the dialog instance, so we can query its element before it closes.
   */
  protected static async _openRevealDialog(handoutId: string, alreadyRevealed: string[]): Promise<void> {
    const pcs = Array.from((game.actors ?? []) as Iterable<Actor>).filter((a) => a.hasPlayerOwner);
    const checks = pcs
      .map((a) => {
        const isAlready = alreadyRevealed.includes(a.id ?? "");
        const attrs = isAlready ? ' disabled checked' : '';
        return `<label class="shp-check"><input type="checkbox" name="actor" value="${escapeHtml(a.id ?? "")}"${attrs}><span class="shp-check__box"></span> ${escapeHtml(a.name ?? "(알 수 없음)")}</label>`;
      })
      .join("");

    const content = `<div class="shp-dialog-body"><p>공개 대상을 선택하세요. <b class="shp-warn">되돌릴 수 없습니다.</b></p><div class="shp-checklist">${checks}</div></div>`;

    const selected = await DialogV2.wait(withDialogTheme({
      window: { title: "비밀 공개" },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "ok",
          label: "공개",
          icon: "fa-solid fa-check",
          class: "shp-dbtn shp-dbtn--primary",
          default: true,
          callback: (
            _event: PointerEvent | SubmitEvent,
            _button: HTMLButtonElement,
            dialog: foundry.applications.api.DialogV2.Any,
          ) => {
            const dlgEl = dialogEl(dialog);
            return Array.from(
              dlgEl.querySelectorAll<HTMLInputElement>('input[name="actor"]:checked:not([disabled])'),
            ).map((el) => el.value);
          },
        },
        { action: "cancel", label: "취소", icon: "fa-solid fa-xmark", class: "shp-dbtn" },
      ],
    }));

    // selected is string[] from ok callback, or "cancel"/"close"/null from dismiss
    if (!Array.isArray(selected) || selected.length === 0) return;

    const api = game.modules.get(MODULE_ID)?.api;
    await api?.revealSecret(handoutId, selected);
    log.info("revealSecret applied", handoutId, selected);
  }
}
