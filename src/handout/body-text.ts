/**
 * body-text: 패널 인라인 본문 편집의 평문 ↔ 최소 HTML 변환·판정.
 * Foundry 무의존 순수 함수(단위 테스트 대상). 본문은 "텍스트 + <br>" 표현만 다룬다.
 */

/** HTML 특수문자 이스케이프(저장 시 사용자 입력 주입 방지). */
function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

/** 기본 엔티티 unescape(htmlToBody 역변환용). &amp; 를 마지막에 풀어 이중 unescape 방지. */
function unescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 평문 → 저장용 HTML. 이스케이프 후 줄바꿈을 <br> 로. 빈/공백 입력은 "". */
export function bodyToHtml(text: string): string {
  if (text.trim() === "") return "";
  return escape(text).replace(/\r?\n/g, "<br>");
}

/**
 * 저장 HTML → 평문(textarea prefill). <br> 류를 \n 으로, 엔티티 unescape.
 * 리터럴 \n 만 있는 구(舊) 본문도 안전 통과.
 */
export function htmlToBody(html: string): string {
  return unescape(html.replace(/<br\s*\/?>/gi, "\n"));
}

/**
 * 인라인 편집 가능 여부. <br> 외 태그가 없으면 true(빈 콘텐츠 포함).
 * 엔티티(&lt; 등)는 태그가 아니므로 영향 없음.
 */
export function isInlineEditable(html: string): boolean {
  const names = [...html.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
  return names.every((n) => n === "br");
}
