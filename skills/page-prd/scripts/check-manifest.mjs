import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** 绑定检查仅验证文件与目录契约，不替代业务或浏览器验收。 */
export async function checkManifest(file) {
  const root = await realpath(dirname(resolve(file)));
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(manifest.pages) || !manifest.pages.length)
    throw new Error("pages 必须为非空数组");
  const ids = new Map();
  const routes = new Set();
  const routePatterns = [];
  const documents = new Set();
  const inside = (path) => {
    const rel = relative(root, path);
    return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
  };
  for (const page of manifest.pages) {
    if (!page || typeof page !== "object") throw new Error("无效页面");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.id || "") || ids.has(page.id))
      throw new Error("无效或重复 id: " + page.id);
    for (const key of ["name", "module", "path", "file"])
      if (typeof page[key] !== "string" || !page[key].trim())
        throw new Error(`${page.id}: 缺少 ${key}`);
    if (!(page.parent === null || typeof page.parent === "string"))
      throw new Error(page.id + ": parent 必须为 id 或 null");
    if (page.aliases !== undefined && !Array.isArray(page.aliases))
      throw new Error(page.id + ": aliases 必须为数组");
    for (const route of [page.path, ...(page.aliases || [])]) {
      if (
        typeof route !== "string" ||
        !route.startsWith("/") ||
        /[?#]/.test(route)
      )
        throw new Error(page.id + ": 路径必须为 pathname");
      const normalized = route.replace(/\/+$/, "") || "/";
      if (routes.has(normalized)) throw new Error("重复路径: " + route);
      routes.add(normalized);
      routePatterns.push({ pageId: page.id, route: normalized });
    }
    // 与参考保存服务按id查找文件的行为保持一致，拒绝路径越界和重复绑定。
    if (page.file !== `documents/${page.id}.md`)
      throw new Error(page.id + ": file 应为 documents/<id>.md");
    const target = await realpath(resolve(root, page.file));
    if (!inside(target) || documents.has(target))
      throw new Error(page.id + ": 文档越界或重复");
    documents.add(target);
    const content = await readFile(target, "utf8");
    for (const heading of ["功能说明", "交互逻辑", "规则与限制"])
      if (!content.split(/\r?\n/).includes("## " + heading))
        throw new Error(`${page.id}: 缺少 ${heading} 章节`);
    // 相对图片必须实际存在于同一文档目录，远程图片不属于本地文件检查范围。
    for (const match of content.matchAll(
      /!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const url = match[1];
      if (/^https?:\/\//.test(url)) continue;
      if (isAbsolute(url) || /^[a-z]+:/i.test(url))
        throw new Error(page.id + ": 图片应使用项目相对路径");
      const image = await realpath(
        resolve(dirname(target), decodeURIComponent(url)),
      );
      if (!inside(image)) throw new Error(page.id + ": 图片越界");
    }
    ids.set(page.id, page);
  }
  // 同长动态模式相交时，首条匹配会造成文档错配；静态路由仍由精确匹配优先。
  for (let left = 0; left < routePatterns.length; left++) {
    for (let right = left + 1; right < routePatterns.length; right++) {
      const a = routePatterns[left];
      const b = routePatterns[right];
      if (a.pageId === b.pageId) continue;
      const aParts = a.route.split("/");
      const bParts = b.route.split("/");
      const overlaps =
        aParts.length === bParts.length &&
        aParts.every(
          (part, index) =>
            part.startsWith(":") ||
            bParts[index].startsWith(":") ||
            part === bParts[index],
        );
      const dynamicBoth =
        aParts.some((part) => part.startsWith(":")) &&
        bParts.some((part) => part.startsWith(":"));
      if (overlaps && dynamicBoth)
        throw new Error(`动态路径重叠: ${a.route} 与 ${b.route}`);
    }
  }
  for (const page of manifest.pages) {
    const seen = new Set([page.id]);
    let child = page;
    while (child.parent !== null) {
      const parent = ids.get(child.parent);
      if (!parent || parent.module !== page.module || seen.has(parent.id))
        throw new Error(page.id + ": 缺失父级、跨模块或目录循环");
      seen.add(parent.id);
      child = parent;
    }
  }
  for (const module of new Set(manifest.pages.map((page) => page.module)))
    if (
      manifest.pages.filter(
        (page) => page.module === module && page.parent === null,
      ).length !== 1
    )
      throw new Error(module + ": 必须有一个默认页");
  for (const history of Object.values(manifest.revisions || {})) {
    if (
      !Array.isArray(history) ||
      history.some(
        (row) =>
          !row ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
          typeof row.content !== "string",
      )
    )
      throw new Error("修订记录格式错误");
  }
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw new Error("用法: node check-manifest.mjs <manifest.json>");
    const manifest = await checkManifest(process.argv[2]);
    console.log(`绑定有效：${manifest.pages.length} 页；仍需浏览器验证。`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
