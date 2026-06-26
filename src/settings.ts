import { MODULE_ID, SETTINGS, type SettingKey } from "./constants";

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.theme, {
    name: "SCH.Settings.Theme.Name",
    hint: "SCH.Settings.Theme.Hint",
    scope: "client",
    config: false,
    type: String,
    default: "light",
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
