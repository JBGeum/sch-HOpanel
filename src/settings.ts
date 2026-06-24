import { MODULE_ID, SETTINGS, type SettingKey } from "./constants";
import type { CategoryDict } from "./handout/handout-flags";

/** 카테고리 사전 기본값(spec §7-3). tone 은 _tokens 의 톤 키. */
export const DEFAULT_CATEGORY_DICT: CategoryDict = {
  main: { label: "메인", tone: "rose" },
  sub: { label: "서브", tone: "blue" },
  yokai: { label: "괴이", tone: "violet" },
  place: { label: "장소", tone: "teal" },
  clue: { label: "복선", tone: "amber" },
};

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.theme, {
    name: "SCH.Settings.Theme.Name",
    hint: "SCH.Settings.Theme.Hint",
    scope: "client",
    config: false,
    type: String,
    default: "light",
  });

  game.settings.register(MODULE_ID, SETTINGS.categoryDict, {
    name: "SCH.Settings.CategoryDict.Name",
    hint: "SCH.Settings.CategoryDict.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_CATEGORY_DICT,
  });

  game.settings.register(MODULE_ID, SETTINGS.debugMode, {
    name: "SCH.Settings.DebugMode.Name",
    hint: "SCH.Settings.DebugMode.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
}

export function getSetting<K extends SettingKey>(key: K) {
  return game.settings.get(MODULE_ID, key);
}

export function setSetting<K extends SettingKey>(
  key: K,
  value: foundry.helpers.ClientSettings.SettingCreateData<typeof MODULE_ID, K>,
) {
  return game.settings.set(MODULE_ID, key, value);
}
