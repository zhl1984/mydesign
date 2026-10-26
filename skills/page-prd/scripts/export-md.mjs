import { readFile, writeFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { checkManifest } from "./check-manifest.mjs";

/** 汇总原Markdown时只调整文档标题层级，保持代码块与业务正文。 */
function rebase(content, number, name) {
  let fence = null;
  const lines = content.replace(/^# [^\n]*\n*/, "").split("\n");
  return (
    `## ${number} ${name}\n\n` +
    lines
      .map((line) => {
        const marker = line.match(/^\s*(`{3,}|~{3,})/);
        if (marker) {
          if (!fence) fence = marker[1];
          else if (
            marker[1][0] === fence[0] &&
            marker[1].length >= fence.length
          )
            fence = null;
          return line;
        }
        return fence ? line : line.replace(/^(#{1,5}) /, "$1# ");
      })
      .join("\n")
      .trim() +
    "\n"
  );
}

try {
  const [file, output, option, scope, ...extra] = process.argv.slice(2);
  if (
    !file ||
    !output ||
    !["--module", "--page"].includes(option) ||
    !scope ||
    extra.length
  )
    throw new Error(
      "用法: node export-md.mjs <manifest.json> <输出.md> --module <模块名> 或 --page <页面id>",
    );
  const manifest = await checkManifest(file);
  const page =
    option === "--page"
      ? manifest.pages.find((item) => item.id === scope)
      : null;
  const module = option === "--module" ? scope : page?.module;
  const pages = manifest.pages.filter((item) => item.module === module);
  if (!pages.length || (option === "--page" && !page))
    throw new Error("找不到指定范围");
  const directory = [];
  /** 编号由同级登记顺序递推，不使用URL深度。 */
  function visit(item, number) {
    directory.push({ item, number });
    pages
      .filter((child) => child.parent === item.id)
      .forEach((child, i) => visit(child, `${number}.${i + 1}`));
  }
  visit(
    pages.find((item) => item.parent === null),
    "1",
  );
  const selected =
    option === "--page"
      ? directory.filter(({ item }) => item.id === page.id)
      : directory;
  const base = dirname(resolve(file));
  // 导出不得覆盖源manifest或任何正文/图片；已有导出也需要另选文件名。
  const target = resolve(output);
  const forbidden = [
    resolve(file),
    ...manifest.pages.map((item) => resolve(base, item.file)),
  ];
  let resolvedTarget = target;
  try {
    resolvedTarget = await realpath(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (forbidden.includes(target) || forbidden.includes(resolvedTarget))
    throw new Error("输出不能覆盖源文件");
  let result = `# ${module} PRD\n\n`;
  if (option === "--module" && manifest.revisions?.[module]?.length) {
    const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
    result +=
      "## 修订记录\n\n| 日期 | 修改内容 |\n| --- | --- |\n" +
      manifest.revisions[module]
        .map((row) => `| ${row.date} | ${cell(row.content)} |`)
        .join("\n") +
      "\n\n";
  }
  for (const { item, number } of selected)
    result +=
      rebase(
        await readFile(resolve(base, item.file), "utf8"),
        number,
        item.name,
      ) + "\n";
  await writeFile(target, result, { flag: "wx" });
  console.log(
    "已导出 " + target + "；图片相对引用保持原文，请随导出文件携带对应资源。",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
