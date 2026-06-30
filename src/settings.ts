import { MODULE_ID, SETTINGS, type SettingKey } from "./constants";

/** theme/fontScale 변경 시 열려 있는 패널을 즉시 재렌더해 반영한다. */
function rerenderPanel(): void {
  const app = foundry.applications.instances.get(MODULE_ID);
  if (app?.rendered) void app.render();
}

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.theme, {
    name: "SCH.Settings.Theme.Name",
    hint: "SCH.Settings.Theme.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      light: "SCH.Settings.Theme.Light",
      dark: "SCH.Settings.Theme.Dark",
      auto: "SCH.Settings.Theme.Auto",
    },
    default: "light",
    onChange: rerenderPanel,
  });

  game.settings.register(MODULE_ID, SETTINGS.fontScale, {
    name: "SCH.Settings.FontScale.Name",
    hint: "SCH.Settings.FontScale.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 80, max: 200, step: 5 },
    default: 100,
    onChange: rerenderPanel,
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
