# sch-handout-panel

Foundry VTT v13+ 모듈. JournalEntry를 응용한 TRPG 핸드아웃(HandOut) 배포 및 비밀 권한 관리.

> TypeScript + Vite 기반. `sch-boilerplate` 보일러플레이트에서 출발했습니다.

## 빠른 시작

```bash
npm install
npm run build      # dist/ 에 완결된 모듈 생성
```

`npm run build` 결과물인 `dist/` 는 그 자체로 완결된 Foundry 모듈입니다.
**`dist/` 의 내용물을 원격 서버(또는 Foundry `Data/modules/sch-handout-panel/`)에 통째로 업로드**하면 동작합니다.

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run build` | TS 번들 + SCSS + `public/` 복사 → `dist/` 취합 |
| `npm run watch` | 변경 감지 빌드 |
| `npm run typecheck` | `tsc --noEmit` 타입 검사 |
| `npm run package:template` | 프로젝트 소스 스냅샷 `sch-handout-panel.zip` 생성 (보일러플레이트 유물, 선택) |

## 구조

```
src/
  module.ts          진입점 (init/ready Hook)
  constants.ts       MODULE_ID, 설정 키
  settings.ts        game.settings 등록 + 접근 헬퍼
  foundry-config.d.ts  fvtt-types 선언 병합 (타입 안정성 핵심)
  apps/example-app.ts  ApplicationV2 + Handlebars 예제 창 (교체 예정)
  utils/logger.ts    모듈 prefix 로거
  styles/module.scss
public/              빌드 시 dist 루트로 그대로 복사
  module.json        매니페스트
  templates/*.hbs
  lang/{en,ko}.json
```

## 릴리스

`v1.0.0` 형태의 태그를 푸시하면 `.github/workflows/release.yml` 이 빌드 후
버전/URL 을 주입하고 `module.json` + `module.zip` 을 GitHub Release 로 게시합니다.

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 라이선스

MIT
