import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = (name, args) =>
  spawnSync(process.execPath, [join(root, "scripts", name), ...args], {
    encoding: "utf8",
  });

/** 用真实临时Markdown模拟已有项目，不改业务文件或已安装技能。 */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "page-prd-kit-"));
  await mkdir(join(directory, "documents"));
  const pages = [
    {
      id: "list",
      name: "项目管理",
      module: "项目管理",
      path: "/projects",
      parent: null,
      file: "documents/list.md",
    },
    {
      id: "create",
      name: "新建项目",
      module: "项目管理",
      path: "/projects/create",
      parent: "list",
      file: "documents/create.md",
    },
  ];
  for (const page of pages)
    await writeFile(
      join(directory, page.file),
      "# " +
        page.name +
        " PRD\n\n## 功能说明\n\n用途\n\n## 交互逻辑\n\n操作\n\n## 规则与限制\n\n```mermaid\nflowchart LR\nA --> B\n```\n",
    );
  const manifest = join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      pages,
      revisions: { 项目管理: [{ date: "2026-10-23", content: "既有记录" }] },
    }),
  );
  return { directory, manifest, pages };
}

test("检查有效绑定并拒绝循环、跨模块父级及越界文档", async () => {
  const f = await fixture();
  try {
    assert.equal(script("check-manifest.mjs", [f.manifest]).status, 0);
    for (const patch of [
      { parent: "create" },
      { module: "其他" },
      { file: "../outside.md" },
    ]) {
      await writeFile(
        f.manifest,
        JSON.stringify({ pages: [f.pages[0], { ...f.pages[1], ...patch }] }),
      );
      const result = script("check-manifest.mjs", [f.manifest]);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.trim());
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("拒绝两个可同时命中的动态路由，允许静态路径优先", async () => {
  const f = await fixture();
  try {
    const pages = f.pages.map((page, i) => ({
      ...page,
      path: i === 0 ? "/projects/:id" : "/projects/:name",
    }));
    await writeFile(f.manifest, JSON.stringify({ pages }));
    assert.notEqual(script("check-manifest.mjs", [f.manifest]).status, 0);
    pages[1].path = "/projects/create";
    await writeFile(f.manifest, JSON.stringify({ pages }));
    assert.equal(script("check-manifest.mjs", [f.manifest]).status, 0);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("模块导出按层级汇总且不修改文件或增加修订", async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.manifest, "utf8");
    const output = join(f.directory, "module.md");
    const result = script("export-md.mjs", [
      f.manifest,
      output,
      "--module",
      "项目管理",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const content = await readFile(output, "utf8");
    assert.match(content, /^# 项目管理 PRD/);
    assert.match(content, /## 1 项目管理/);
    assert.match(content, /## 1\.1 新建项目/);
    assert.match(content, /```mermaid\nflowchart LR\nA --> B\n```/);
    assert.equal(content.match(/既有记录/g).length, 1);
    assert.equal(await readFile(f.manifest, "utf8"), before);
    assert.notEqual(script("export-md.mjs", [f.manifest, output]).status, 0);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("安装后可重装，备份旧版本，并保留既有符号链接", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prd-install-"));
  const actual = join(directory, "shared", "page-prd");
  const target = join(directory, "client", "skills", "page-prd");
  const backup = join(directory, "backups");
  try {
    await mkdir(actual, { recursive: true });
    await mkdir(join(directory, "client", "skills"), { recursive: true });
    await writeFile(join(actual, "SKILL.md"), "old version");
    await symlink(actual, target, "dir");
    const result = script("install.mjs", [
      "--target",
      target,
      "--backup-dir",
      backup,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await lstat(target)).isSymbolicLink(), true);
    assert.match(
      await readFile(join(actual, "SKILL.md"), "utf8"),
      /name: page-prd/,
    );
    const saved = JSON.parse(result.stdout);
    assert.equal(
      await readFile(join(saved.backup, "SKILL.md"), "utf8"),
      "old version",
    );
    assert.equal(
      script("install.mjs", ["--target", target, "--backup-dir", backup])
        .status,
      0,
    );
    const fresh = join(directory, "new", "skills", "page-prd");
    assert.equal(
      script("install.mjs", ["--target", fresh, "--backup-dir", backup]).status,
      0,
    );
    assert.match(
      await readFile(join(fresh, "SKILL.md"), "utf8"),
      /name: page-prd/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
