import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { createReviewServer } from "../designs/prd-review-v1/server.mjs";

interface PrdManifest {
  pages: Array<{ id: string; file: string }>;
  revisions?: Record<string, Array<{ date: string; content: string }>>;
}
const assets = [
  "index.html",
  "app.mjs",
  "comments.mjs",
  "document.mjs",
  "figures.mjs",
  "state.mjs",
  "review.css",
];

/** PRD只发布静态文档资源，本地写入由Vite处理，不注册或改写业务路由。 */
export function pagePrdIntegrationPlugin(): Plugin {
  let root = "",
    base = "/";
  let directory = "";
  /** 正文和版本来自同一个文件，前端更新继续使用既有冲突校验。 */
  const loadManifest = async (): Promise<PrdManifest> =>
    JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ) as PrdManifest;
  return {
    name: "page-prd-integration",
    configResolved(config) {
      root = config.root;
      base = config.base;
      directory = join(root, "designs/prd-review-v1");
    },
    async configureServer(server) {
      const manifest = await loadManifest();
      const files = createReviewServer(
        join(directory, "documents"),
        manifest.pages.map((page) => page.id),
      );
      const prefix = base + "__page-prd/";
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || "/", "http://localhost").pathname;
        // 只拦截独占静态资源前缀，登录、首页及任何业务路径原样交给Vite。
        if (!pathname.startsWith(prefix)) return next();
        const rest = pathname.slice(prefix.length);
        if (rest === "manifest.json") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          loadManifest()
            .then((data) =>
              res.end(JSON.stringify({ ...data, runtime: { editable: true } })),
            )
            .catch(() => {
              res.statusCode = 500;
              res.end(JSON.stringify({ message: "无法读取文档绑定" }));
            });
          return;
        }
        // 静态JSON读取与本地写入共享处理器，不开放额外服务端口。
        req.url = rest.startsWith("documents/")
          ? "/" + rest.replace(/\.json$/, "")
          : rest === "images"
            ? "/images"
            : "/__prd-review/" + rest;
        files.emit("request", req, res);
      });
    },
    async generateBundle() {
      const manifest = await loadManifest();
      /** 仅发布白名单；浏览器模块统一为 js，兼容默认静态服务器 MIME 映射。 */
      const emit = async (name: string, path: string): Promise<void> => {
        const source = await readFile(path);
        // 入口和完整依赖链一起改写，包括 Mermaid 延迟加载的内部模块。
        const browserCode = /\.(html|m?js)$/.test(name);
        this.emitFile({
          type: "asset",
          fileName: "__page-prd/" + name.replace(/\.mjs$/, ".js"),
          source: browserCode
            ? source.toString("utf8").replace(/\.mjs(?=["'])/g, ".js")
            : source,
        });
      };
      for (const name of assets) await emit(name, join(directory, name));
      this.emitFile({
        type: "asset",
        fileName: "__page-prd/manifest.json",
        source: JSON.stringify({ ...manifest, runtime: { editable: false } }),
      });
      for (const page of manifest.pages) {
        const content = await readFile(join(directory, page.file), "utf8");
        this.emitFile({
          type: "asset",
          fileName: `__page-prd/documents/${page.id}.json`,
          source: JSON.stringify({
            content,
            version: createHash("sha256").update(content).digest("hex"),
          }),
        });
      }
      /** 图表引擎及上传图片保留相对目录，运行时可按需加载且不依赖CDN。 */
      const collect = async (
        path: string,
        target: string,
        extension: RegExp,
      ): Promise<void> => {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const source = join(path, entry.name);
          if (entry.isDirectory()) await collect(source, target, extension);
          else if (extension.test(entry.name))
            await emit(
              target +
                "/" +
                relative(
                  target === "vendor"
                    ? resolve(root, "node_modules/mermaid/dist")
                    : join(directory, "documents/assets/uploads"),
                  source,
                )
                  .split("\\")
                  .join("/"),
              source,
            );
        }
      };
      await collect(
        resolve(root, "node_modules/mermaid/dist"),
        "vendor",
        /\.m?js$/,
      );
      try {
        await collect(
          join(directory, "documents/assets/uploads"),
          "assets/uploads",
          /\.(png|jpg|webp|gif)$/,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
