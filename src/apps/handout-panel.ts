import { MODULE_ID, SETTINGS } from "../constants";
import { getSetting, setSetting, DEFAULT_CATEGORY_DICT } from "../settings";
import { getHandoutDoc, listHandoutDocs } from "../handout/handout-repo";
import { toHandoutView, type HandoutView } from "../handout/handout-view";
import { log } from "../utils/logger";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

interface PanelContext extends foundry.applications.api.ApplicationV2.RenderContext {
  theme: string;
  isDark: boolean;
  count: number;
  rows: (HandoutView & { expanded: boolean })[];
}

export class HandoutPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  #expanded = new Set<string>();

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
    },
  };

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

    return { ...base, theme, isDark: theme === "dark", count: rows.length, rows };
  }

  /** Used as action handler for "toggle-theme". Protected prefix so it's accessible from DEFAULT_OPTIONS. */
  protected static async _onToggleTheme(this: HandoutPanel): Promise<void> {
    const next = ((getSetting(SETTINGS.theme) as string) ?? "light") === "light" ? "dark" : "light";
    await setSetting(SETTINGS.theme, next);
    void this.render();
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
        return `<label style="display:block"><input type="checkbox" name="actor" value="${a.id ?? ""}"${attrs}> ${a.name ?? "(알 수 없음)"}</label>`;
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
            const dlgEl = (dialog as unknown as { element: HTMLElement }).element;
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
