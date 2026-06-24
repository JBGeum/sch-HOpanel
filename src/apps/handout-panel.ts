import { MODULE_ID, SETTINGS } from "../constants";
import { getSetting, setSetting, DEFAULT_CATEGORY_DICT } from "../settings";
import { getHandoutDoc, listHandoutDocs } from "../handout/handout-repo";
import { toHandoutView, type HandoutView } from "../handout/handout-view";
import { parseTags } from "../handout/handout-create";
import type { Owner } from "../handout/reveal-state";
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
      delete: HandoutPanel._onDelete,
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
   * 삭제 확인 다이얼로그(DialogV2.confirm) → 확인 시 공개 API 로 삭제 → 재렌더.
   * entry.delete() 는 되돌릴 수 없으므로 1단계 확인 필수(회수와 달리 데이터 자체 제거).
   */
  protected static async _onDelete(this: HandoutPanel, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const id = target.dataset.handoutId;
    if (!id) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "핸드아웃 삭제" },
      content: "<p>이 핸드아웃을 삭제합니다. <b>되돌릴 수 없습니다.</b></p>",
      rejectClose: false,
    });
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

    const actorOptions = pcs
      .map((a) => `<option value="${escapeHtml(a.id ?? "")}">${escapeHtml(a.name ?? "(알 수 없음)")}</option>`)
      .join("");
    const tagOptions = Object.entries(dict)
      .map(([key, def]) => `<option value="${escapeHtml(key)}">${escapeHtml(def.label)}</option>`)
      .join("");

    const pcAttrs = hasPc ? "checked" : "disabled";
    const floatingAttrs = hasPc ? "" : "checked";
    const actorRowStyle = hasPc ? "" : "display:none";

    const content = `
      <div class="sch-create-form">
        <fieldset class="sch-create-kind">
          <legend>종류</legend>
          <label><input type="radio" name="kind" value="pc" ${pcAttrs}> PC</label>
          <label><input type="radio" name="kind" value="floating" ${floatingAttrs}> 떠도는</label>
        </fieldset>
        <div class="sch-create-actor" style="${actorRowStyle}">
          <label>소유자 액터<br><select name="actorId">${actorOptions}</select></label>
        </div>
        <label>표면<br><textarea name="surface" rows="3"></textarea></label>
        <label>비밀<br><textarea name="secret" rows="3"></textarea></label>
        <label>태그<br><select name="tags" multiple size="4">${tagOptions}</select></label>
        <label>추가 태그(쉼표 구분)<br><input type="text" name="freeTags"></label>
      </div>`;

    const result = await DialogV2.wait({
      window: { title: "핸드아웃 생성" },
      content,
      rejectClose: false,
      // 동적 토글: kind 변경 시 actorId 행 표시/숨김.
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
          default: true,
          // Cast rationale: ButtonCallback 의 dialog 는 DialogV2.Any. element 는 HTMLElement.
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
              el.querySelectorAll<HTMLOptionElement>('select[name="tags"] option:checked'),
            ).map((o) => o.value);
            const freeTags = el.querySelector<HTMLInputElement>('input[name="freeTags"]')?.value ?? "";
            const out: CreateFormResult = { kind, actorId, surface, secret, tags, freeTags };
            return out;
          },
        },
        { action: "cancel", label: "취소", icon: "fa-solid fa-xmark" },
      ],
    });

    // result: CreateFormResult(ok) | "cancel"(취소) | null(dismiss)
    if (!result || typeof result === "string") return null;
    return result as CreateFormResult;
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
        return `<label style="display:block"><input type="checkbox" name="actor" value="${escapeHtml(a.id ?? "")}"${attrs}> ${escapeHtml(a.name ?? "(알 수 없음)")}</label>`;
      })
      .join("");

    const content = `<p>공개 대상을 선택하세요. <b>되돌릴 수 없습니다.</b></p>${checks}`;

    const selected = await DialogV2.wait({
      window: { title: "비밀 공개" },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "ok",
          label: "공개",
          icon: "fa-solid fa-check",
          default: true,
          // Cast rationale: ButtonCallback receives (event, button, dialog: DialogV2.Any).
          // We query dialog.element which is HTMLElement on ApplicationV2 — the cast from
          // DialogV2.Any to the base class is safe; only HTMLElement querying is performed.
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
        {
          action: "cancel",
          label: "취소",
          icon: "fa-solid fa-xmark",
        },
      ],
    });

    // selected is string[] from ok callback, or "cancel"/"close"/null from dismiss
    if (!Array.isArray(selected) || selected.length === 0) return;

    const api = game.modules.get(MODULE_ID)?.api;
    await api?.revealSecret(handoutId, selected);
    log.info("revealSecret applied", handoutId, selected);
  }
}
