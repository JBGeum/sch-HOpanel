import { MODULE_ID, SETTINGS, type SettingKey } from "./constants";

/**
 * game.settings 등록. init Hook 에서 호출한다.
 * 새 설정을 추가할 때 이 함수에 register 호출을 한 줄 더 넣는다.
 */
export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.welcomed, {
    name: "SCH.Settings.Welcomed.Name",
    hint: "SCH.Settings.Welcomed.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.showHints, {
    name: "SCH.Settings.ShowHints.Name",
    hint: "SCH.Settings.ShowHints.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
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

/**
 * 타입 안전한 설정 읽기 헬퍼. 키에 따라 반환 값 타입이 자동 추론된다.
 * (foundry-config.d.ts 의 SettingConfig 선언이 근거)
 */
export function getSetting<K extends SettingKey>(key: K) {
  return game.settings.get(MODULE_ID, key);
}

/** 타입 안전한 설정 쓰기 헬퍼. 키에 맞는 값 타입만 허용된다. */
export function setSetting<K extends SettingKey>(
  key: K,
  value: foundry.helpers.ClientSettings.SettingCreateData<typeof MODULE_ID, K>,
) {
  return game.settings.set(MODULE_ID, key, value);
}
