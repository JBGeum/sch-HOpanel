import { MODULE_ID, SETTINGS } from "../constants";
import { getSetting, setSetting, DEFAULT_CATEGORY_DICT } from "../settings";
import { getHandoutDoc, listHandoutDocs, type HandoutDoc } from "../handout/handout-repo";
import { toHandoutView, type HandoutView } from "../handout/handout-view";
import { parseTags, splitTagsForEdit } from "../handout/handout-create";
import type { Owner, SurfaceMode } from "../handout/reveal-state";
import type { CategoryDict, HandoutKind } from "../handout/handout-flags";
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

/** categoryDict → .shp-check 체크박스 라벨 문자열. selectedKeys 의 키는 checked. */
function buildTagChecks(dict: CategoryDict, selectedKeys: string[] = []): string {
  return Object.entries(dict)
    .map(([key, def]) => {
      const checked = selectedKeys.includes(key) ? " checked" : "";
      return `<label class="shp-check"><input type="checkbox" name="tag" value="${escapeHtml(key)}"${checked}><span class="shp-check__box"></span> ${escapeHtml(def.label)}</label>`;
    })
    .join("");
}

interface PanelContext extends foundry.applications.api.ApplicationV2.RenderContext {
  theme: string;
  isDark: boolean;
  isGM: boolean;
  count: number;
  rows: (HandoutView & { expanded: boolean })[];
}

/** 생성 다이얼로그 ok 콜백이 dialog.element 에서 수집해 반환하는 폼 값. */
interface CreateFormResult {
  kind: HandoutKind;
  actorId: string;
  surface: string;
  secret: string;
  tags: string[];
  freeTags: string;
  name: string;
}

/** 편집 다이얼로그 ok 콜백이 dialog.element 에서 수집해 반환하는 폼 값(본문 없음). */
interface EditFormResult {
  kind: HandoutKind;
  actorId: string;
  tags: string[];
  freeTags: string;
  name: string;
}

export class HandoutPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  #expanded = new Set<string>();
  /** Cached handout count from the last _prepareContext call; used by the title getter. */
  #lastCount = 0;

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
    const dict =
      (getSetting(SETTINGS.categoryDict) as Record<string, { label: string; tone: string }>) ??
      DEFAULT_CATEGORY_DICT;

    const rows = listHandoutDocs()
      .map((doc) => toHandoutView(doc, dict))
      .filter((v): v is HandoutView => v !== null)
      // 표면 hidden 이고 관리 불가면 카드 미표시(§6-5)
      .filter((v) => !(v.surfaceChip.state === "hidden" && !v.canManage))
      .map((v) => ({ ...v, expanded: this.#expanded.has(v.id) }));

    // Cache count so the synchronous title getter can read it without re-querying.
    this.#lastCount = rows.length;

    return { ...base, theme, isDark: theme === "dark", isGM: game.user?.isGM ?? false, count: rows.length, rows };
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
    const dict = (getSetting(SETTINGS.categoryDict) as CategoryDict) ?? DEFAULT_CATEGORY_DICT;
    const result = await HandoutPanel._openCreateDialog(dict);
    if (!result) return;
    const tags = parseTags(result.tags, result.freeTags);
    const owner: Owner =
      result.kind === "pc" ? { kind: "actor", actorId: result.actorId } : { kind: "gm" };
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.createHandout({
      owner,
      kind: result.kind,
      tags,
      surface: result.surface,
      secret: result.secret,
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
  protected static async _openCreateDialog(dict: CategoryDict): Promise<CreateFormResult | null> {
    const pcs = Array.from((game.actors ?? []) as Iterable<Actor>).filter((a) => a.hasPlayerOwner);
    const hasPc = pcs.length > 0;

    const actorOptions = buildActorOptions(pcs);
    const tagChecks = buildTagChecks(dict);

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
        <div class="shp-field"><div class="shp-field__label">표면</div><textarea class="shp-textarea" name="surface" rows="3"></textarea></div>
        <div class="shp-field"><div class="shp-field__label">비밀</div><textarea class="shp-textarea" name="secret" rows="3"></textarea></div>
        <div class="shp-field"><div class="shp-field__label">태그</div><div class="shp-checklist shp-checklist--wrap">${tagChecks}</div></div>
        <div class="shp-field"><div class="shp-field__label">추가 태그<em>(쉼표 구분)</em></div><input class="shp-input" type="text" name="freeTags"></div>
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
            const tags = Array.from(
              el.querySelectorAll<HTMLInputElement>('input[name="tag"]:checked'),
            ).map((o) => o.value);
            const freeTags = el.querySelector<HTMLInputElement>('input[name="freeTags"]')?.value ?? "";
            const name = el.querySelector<HTMLInputElement>('input[name="title"]')?.value ?? "";
            const out: CreateFormResult = { kind, actorId, surface, secret, tags, freeTags, name };
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
    const dict = (getSetting(SETTINGS.categoryDict) as CategoryDict) ?? DEFAULT_CATEGORY_DICT;
    const result = await HandoutPanel._openEditDialog(doc, dict);
    if (!result) return;
    const tags = parseTags(result.tags, result.freeTags);
    const owner: Owner =
      result.kind === "pc" ? { kind: "actor", actorId: result.actorId } : { kind: "gm" };
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.updateHandoutMeta(id, { owner, kind: result.kind, tags, name: result.name });
    log.info("updateHandoutMeta requested", id, owner, tags);
    void this.render();
  }

  /**
   * 표면 가시성 세그먼트(GM 전용 액션). 현재 mode 재클릭은 no-op.
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
   * 편집 폼 다이얼로그(DialogV2.wait). 생성 다이얼로그와 동일 구조이되 본문(표면/비밀) 없음 +
   * 현재값 prefill: kind 라디오 체크, actorId select 선택, 태그(dict)는 선택·커스텀 태그는 freeTags.
   * 0-액터 처리(pc 비활성·기본 떠도는)·동적 토글·escapeHtml 은 생성과 동일.
   */
  protected static async _openEditDialog(doc: HandoutDoc, dict: CategoryDict): Promise<EditFormResult | null> {
    const pcs = Array.from((game.actors ?? []) as Iterable<Actor>).filter((a) => a.hasPlayerOwner);
    const hasPc = pcs.length > 0;
    const { selected: selectedTags, free: freeTagsValue } = splitTagsForEdit(doc.flags.tags, dict);
    const currentKind = doc.flags.kind;
    const currentActorId = doc.flags.owner.actorId;

    // prefill + 0-액터 처리: pc 는 hasPc 없으면 비활성, 현재 kind 에 따라 checked.
    const pcDisabled = hasPc ? "" : " disabled";
    const pcChecked = currentKind === "pc" && hasPc ? " checked" : "";
    const floatingChecked = currentKind === "floating" || !hasPc ? " checked" : "";
    const showActor = currentKind === "pc" && hasPc;
    const actorRowStyle = showActor ? "" : "display:none";

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
        <div class="shp-field"><div class="shp-field__label">태그</div><div class="shp-checklist shp-checklist--wrap">${buildTagChecks(dict, selectedTags)}</div></div>
        <div class="shp-field"><div class="shp-field__label">추가 태그<em>(쉼표 구분)</em></div><input class="shp-input" type="text" name="freeTags" value="${escapeHtml(freeTagsValue)}"></div>
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
            const tags = Array.from(
              el.querySelectorAll<HTMLInputElement>('input[name="tag"]:checked'),
            ).map((o) => o.value);
            const freeTags = el.querySelector<HTMLInputElement>('input[name="freeTags"]')?.value ?? "";
            const name = el.querySelector<HTMLInputElement>('input[name="title"]')?.value ?? "";
            const out: EditFormResult = { kind, actorId, tags, freeTags, name };
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
   * 표면 limited 대상 선택 다이얼로그. _openRevealDialog 와 동형이되 교체(replace) 의미론:
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

    const content = `<div class="shp-dialog-body"><p>표면을 볼 대상을 선택하세요.</p><div class="shp-checklist">${checks}</div></div>`;

    const selected = await DialogV2.wait(withDialogTheme({
      window: { title: "표면 가시성 — 일부" },
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
