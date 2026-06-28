/**
 * 채팅 카드 HTML 빌더(순수). ChatMessage.content 로 들어간다.
 * name/typeLabel/ownerName/theme 는 escape, body(저널 리치텍스트, GM 신뢰 출처)는 그대로 삽입.
 */
import type { HandoutKind } from "./handout-flags";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function buildChatCard(args: {
  name: string;
  typeLabel: string;
  kind: HandoutKind;
  ownerName: string;
  area: "surface" | "secret";
  body: string;
  theme: string;
}): string {
  const label = args.area === "surface" ? "앞면" : "비밀";
  const contentClass =
    args.area === "surface" ? "shp-chatcard__content" : "shp-chatcard__content shp-chatcard__content--secret";
  return (
    `<div class="sch-handout-panel shp-chatcard shp-chatcard--${args.area}" data-theme="${esc(args.theme)}">` +
    `<div class="shp-chatcard__header">` +
    `<span class="shp-type" data-type="${esc(args.kind)}">${esc(args.typeLabel)}</span>` +
    `<span class="shp-chatcard__name">${esc(args.name)}</span>` +
    `<span class="shp-chatcard__sub">${esc(args.ownerName)}</span>` +
    `</div>` +
    `<div class="shp-chatcard__label shp-chatcard__label--${args.area}">${label}</div>` +
    `<div class="${contentClass}">${args.body}</div>` +
    `</div>`
  );
}
