import { describe, it, expect } from "vitest";
import { bodyToHtml, htmlToBody, isInlineEditable } from "../src/handout/body-text";

describe("bodyToHtml", () => {
  it("줄바꿈을 <br> 로 변환", () => {
    expect(bodyToHtml("a\nb")).toBe("a<br>b");
  });
  it("CRLF 도 <br> 로", () => {
    expect(bodyToHtml("a\r\nb")).toBe("a<br>b");
  });
  it("HTML 특수문자 이스케이프", () => {
    expect(bodyToHtml('a<b & "c"')).toBe("a&lt;b &amp; &quot;c&quot;");
  });
  it("빈/공백 입력 → 빈 문자열", () => {
    expect(bodyToHtml("")).toBe("");
    expect(bodyToHtml("   \n  ")).toBe("");
  });
});

describe("htmlToBody", () => {
  it("<br> 류를 \\n 으로", () => {
    expect(htmlToBody("a<br>b")).toBe("a\nb");
    expect(htmlToBody("a<br/>b")).toBe("a\nb");
    expect(htmlToBody("a<br />b")).toBe("a\nb");
  });
  it("엔티티 unescape", () => {
    expect(htmlToBody("a&lt;b &amp; &quot;c&quot;")).toBe('a<b & "c"');
  });
  it("리터럴 \\n 만 있는 구 본문도 통과", () => {
    expect(htmlToBody("line1\nline2")).toBe("line1\nline2");
  });
});

describe("round-trip", () => {
  it("htmlToBody(bodyToHtml(x)) === x (비-공백 입력)", () => {
    for (const x of ["a\nb", 'a<b & "c"\nd', "여러\n\n줄\n끝", "x"]) {
      expect(htmlToBody(bodyToHtml(x))).toBe(x);
    }
  });
});

describe("isInlineEditable", () => {
  it("평문/빈 문자열 → true", () => {
    expect(isInlineEditable("")).toBe(true);
    expect(isInlineEditable("hello world")).toBe(true);
  });
  it("<br> 만 → true", () => {
    expect(isInlineEditable("a<br>b")).toBe(true);
    expect(isInlineEditable("a<br/>b<br />c")).toBe(true);
  });
  it("<br> 외 태그 → false", () => {
    expect(isInlineEditable("<p>x</p>")).toBe(false);
    expect(isInlineEditable("<strong>x</strong>")).toBe(false);
    expect(isInlineEditable("<ul><li>x</li></ul>")).toBe(false);
  });
  it("엔티티는 태그가 아님 → true", () => {
    expect(isInlineEditable("a&lt;b&gt;c")).toBe(true);
  });
});
