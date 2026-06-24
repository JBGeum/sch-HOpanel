import { defineConfig } from "vite";

/**
 * 빌드 결과 `dist/`는 그 자체로 완결된(self-contained) Foundry 모듈이다.
 * - `src/module.ts` → `dist/module.js` (ESM 번들)
 * - `src/styles/module.scss` → `dist/module.css`
 * - `public/` 전체(module.json, templates, lang)는 그대로 `dist/`로 복사
 *
 * 원격 서버에는 `dist/`의 내용물을 통째로 업로드하면 된다.
 */
export default defineConfig({
  // public/ 의 내용은 빌드 시 dist 루트로 복사된다(Vite 기본 동작).
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "src/module.ts",
      formats: ["es"],
      fileName: () => "module.js",
    },
    rollupOptions: {
      output: {
        // 추출된 CSS를 항상 module.css 로 출력
        assetFileNames: "module.css",
      },
    },
  },
});
