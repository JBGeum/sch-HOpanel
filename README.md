# sch-boilerplate

Foundry VTT v13+ 모듈 개발용 boilerplate (TypeScript + Vite).

새 모듈을 시작할 때 이 템플릿을 복사해 모듈 ID와 예제만 교체하면 바로 개발을 시작할 수 있습니다.

## 빠른 시작

```bash
npm install
npm run build      # dist/ 에 완결된 모듈 생성
```

`npm run build` 결과물인 `dist/` 는 그 자체로 완결된 Foundry 모듈입니다.
**`dist/` 의 내용물을 원격 서버(또는 Foundry `Data/modules/sch-boilerplate/`)에 통째로 업로드**하면 동작합니다.

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run build` | TS 번들 + SCSS + `public/` 복사 → `dist/` 취합 |
| `npm run watch` | 변경 감지 빌드 |
| `npm run typecheck` | `tsc --noEmit` 타입 검사 |
| `npm run package:template` | 새 프로젝트용 소스 템플릿 `sch-boilerplate.zip` 생성 |

## 구조

```
src/
  module.ts          진입점 (init/ready Hook)
  constants.ts       MODULE_ID, 설정 키
  settings.ts        game.settings 등록 + 접근 헬퍼
  apps/example-app.ts  ApplicationV2 + Handlebars 예제 창
  utils/logger.ts    모듈 prefix 로거
  styles/module.scss
public/              빌드 시 dist 루트로 그대로 복사
  module.json        매니페스트
  templates/*.hbs
  lang/{en,ko}.json
```

## 새 모듈로 전환하기

1. `public/module.json` 의 `id`/`title`/`url`/`manifest`/`download` 수정
2. `src/constants.ts` 의 `MODULE_ID` 를 같은 값으로 변경
3. `package.json` 의 `name` 변경
4. `lang/*.json` 의 `SCH.*` 네임스페이스를 새 모듈에 맞게 교체

## 릴리스

`v1.0.0` 형태의 태그를 푸시하면 `.github/workflows/release.yml` 이 빌드 후
버전/URL 을 주입하고 `module.json` + `module.zip` 을 GitHub Release 로 게시합니다.

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 라이선스

MIT
