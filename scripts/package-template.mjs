/**
 * 새 모듈 개발 프로젝트를 시작할 때 풀어 쓰는 "프로젝트 소스 템플릿" 압축본을 만든다.
 *
 * 빌드된 Foundry 모듈(dist)이 아니라 프로젝트 소스 전체를 담는다.
 * 제외: node_modules / dist / .git / .idea / 기존 zip 산출물
 *
 * 사용: npm run package:template  →  저장소 루트에 sch-handout-panel.zip 생성
 */
import { createWriteStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import archiver from "archiver";

const ROOT = process.cwd();
const OUT_NAME = "sch-handout-panel.zip";
const OUT_PATH = join(ROOT, OUT_NAME);

// docs/ 는 이 boilerplate 의 설계/브레인스토밍 산출물이라 새 프로젝트 scaffold 에는 제외한다.
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git", ".idea", "docs"]);
const EXCLUDE_FILES = new Set([OUT_NAME]);

/** 제외 디렉터리를 건너뛰며 모든 파일 경로를 수집한다. */
async function collectFiles(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      await collectFiles(full, acc);
    } else if (!EXCLUDE_FILES.has(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = await collectFiles(ROOT);
const output = createWriteStream(OUT_PATH);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log(`${OUT_NAME} created — ${files.length} files, ${archive.pointer()} bytes`);
});
archive.on("warning", (err) => {
  throw err;
});
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
for (const file of files) {
  // zip 내부 경로는 항상 POSIX 구분자 사용
  const name = relative(ROOT, file).split(sep).join("/");
  archive.file(file, { name });
}
await archive.finalize();
