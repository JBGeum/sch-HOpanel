import { describe, it, expect } from "vitest";
import { buildChatCard } from "../src/handout/handout-chat";

describe("buildChatCard", () => {
  it("surface card → label 앞면, non-secret content box, raw body", () => {
    const html = buildChatCard({
      name: "마을 지도", typeLabel: "PC", kind: "pc", ownerName: "길동",
      area: "surface", body: "<p>지도</p>", theme: "light",
    });
    expect(html).toContain("앞면");
    expect(html).toContain('class="shp-chatcard__content"');
    expect(html).toContain("shp-chatcard__label--surface");
    expect(html).not.toContain("--secret");
    expect(html).toContain("<p>지도</p>");
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-type="pc"');
  });
  it("secret card → label 비밀 + --secret classes", () => {
    const html = buildChatCard({
      name: "x", typeLabel: "공용", kind: "floating", ownerName: "공용",
      area: "secret", body: "비밀내용", theme: "dark",
    });
    expect(html).toContain("비밀");
    expect(html).toContain("shp-chatcard__content--secret");
    expect(html).toContain("shp-chatcard__label--secret");
    expect(html).toContain('data-theme="dark"');
  });
  it("escapes name/ownerName/typeLabel but not body", () => {
    const html = buildChatCard({
      name: "<b>n</b>", typeLabel: "PC", kind: "pc", ownerName: "<i>o</i>",
      area: "surface", body: "<p>raw</p>", theme: "light",
    });
    expect(html).toContain("&lt;b&gt;n&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;o&lt;/i&gt;");
    expect(html).toContain("<p>raw</p>");
  });
});
