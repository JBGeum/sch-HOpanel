import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { log } from "../src/utils/logger";

/** game.settings.get 이 debugMode 로 반환할 값을 정해 전역 game 을 stub 한다. */
function stubDebug(value: boolean): void {
  vi.stubGlobal("game", { settings: { get: () => value } });
}

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let debugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("log gating by debugMode", () => {
  it("debugMode off: info/warn/debug 침묵, error 출력", () => {
    stubDebug(false);
    log.info("hi");
    log.warn("careful");
    log.debug("trace");
    log.error("boom");
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("debugMode on: info/warn/debug/error 모두 출력", () => {
    stubDebug(true);
    log.info("hi");
    log.warn("careful");
    log.debug("trace");
    log.error("boom");
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
