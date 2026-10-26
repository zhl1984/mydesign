import { createServer, request as proxyRequest } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const hash = (content) => createHash("sha256").update(content).digest("hex");

/** 同一文件串行处理版本校验和写入，旧浏览器不能覆盖较新的文档。 */
export function createReviewServer(
  directory = join(root, "documents"),
  ids = ["login", "project-list", "project-create"],
  assetsDirectory = join(directory, "assets"),
) {
  let saves = Promise.resolve();
  return createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/images" && req.method === "POST") {
      if (
        !["http://127.0.0.1:4311", "http://127.0.0.1:3000"].includes(
          req.headers.origin,
        )
      )
        return send(403, { message: "不允许的上传来源" });
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 7 * 1024 * 1024)
            return send(413, { message: "图片不能超过5MB" });
        }
        const data = JSON.parse(body);
        const formats = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
        };
        const extension = formats[data.type];
        if (!extension || typeof data.data !== "string")
          return send(400, { message: "仅支持PNG、JPEG、WebP和GIF图片" });
        const bytes = Buffer.from(data.data, "base64");
        if (bytes.length > 5 * 1024 * 1024)
          return send(413, { message: "图片不能超过5MB" });
        const valid =
          extension === "png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : extension === "jpg"
              ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
              : extension === "gif"
                ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
                : bytes.subarray(0, 4).toString() === "RIFF" &&
                  bytes.subarray(8, 12).toString() === "WEBP";
        if (!valid) return send(400, { message: "图片内容与格式不匹配" });
        const name = hash(bytes) + "." + extension;
        await mkdir(join(assetsDirectory, "uploads"), { recursive: true });
        await writeFile(join(assetsDirectory, "uploads", name), bytes);
        return send(201, { url: "./assets/uploads/" + name });
      } catch {
        return send(400, { message: "图片上传失败，请检查文件后重试" });
      }
    }
    if (pathname.startsWith("/documents/")) {
      const id = pathname.slice("/documents/".length);
      if (!ids.includes(id)) return send(404, { message: "未登记的文档" });
      if (!["GET", "PUT"].includes(req.method))
        return send(405, { message: "不支持的操作" });
      try {
        const path = join(directory, id + ".md");
        if (req.method === "GET") {
          const content = await readFile(path, "utf8");
          return send(200, {
            content,
            version: hash(content),
            file: "designs/prd-review-v1/documents/" + id + ".md",
          });
        }
        // 预览仅由本机页面写入，阻止其他网站跨源触发文件修改。
        if (
          !["http://127.0.0.1:4311", "http://127.0.0.1:3000"].includes(
            req.headers.origin,
          )
        )
          return send(403, { message: "不允许的保存来源" });
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024 * 1024)
            return send(413, { message: "文档过大" });
        }
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          return send(400, { message: "保存内容格式错误" });
        }
        if (
          typeof data.content !== "string" ||
          typeof data.version !== "string"
        )
          return send(400, { message: "缺少正文或版本" });
        saves = saves
          .then(async () => {
            const current = await readFile(path, "utf8");
            if (hash(current) !== data.version)
              return send(409, {
                message:
                  "文件已由其他窗口或本地工具修改，请先复制当前修改再重新加载",
              });
            await writeFile(path, data.content, "utf8");
            send(200, { version: hash(data.content) });
          })
          .catch(() =>
            send(500, { message: "文件写入失败，当前修改尚未保存" }),
          );
        await saves;
      } catch {
        send(500, { message: "无法读取文档文件" });
      }
      return;
    }
    if (pathname.startsWith("/__prd-review/")) {
      const rel = pathname.slice("/__prd-review/".length);
      const files = [
        "index.html",
        "review.css",
        "app.mjs",
        "document.mjs",
        "state.mjs",
        "comments.mjs",
        "figures.mjs",
        "manifest.json",
      ];
      const vendor =
        /^vendor\/[a-zA-Z0-9_./-]+\.m?js$/.test(rel) && !rel.includes("..");
      const upload = /^assets\/uploads\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(
        rel,
      );
      if (!files.includes(rel) && !vendor && !upload)
        return send(404, { message: "文件不存在" });
      const types = {
        html: "text/html",
        css: "text/css",
        mjs: "text/javascript",
        json: "application/json",
        svg: "image/svg+xml",
        js: "text/javascript",
        png: "image/png",
        jpg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
      };
      try {
        const path = vendor
          ? resolve(root, "../../node_modules/mermaid/dist", rel.slice(7))
          : upload
            ? join(assetsDirectory, rel.slice(7))
            : join(root, rel);
        const data = await readFile(path);
        const type = types[basename(rel).split(".").at(-1)];
        res.writeHead(200, {
          "Content-Type":
            type + (type.startsWith("image/") ? "" : "; charset=utf-8"),
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch {
        send(404, { message: "文件不存在" });
      }
      return;
    }
    // 同源代理已有开发页，预览不改变真实页面、登录与业务接口实现。
    const target = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1:3000" },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      },
    );
    target.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("请先启动本地项目 http://127.0.0.1:3000");
    });
    req.pipe(target);
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL("file://" + process.argv[1]))
) {
  const server = createReviewServer();
  server.listen(4311, "127.0.0.1", () =>
    console.log("PRD预览 http://127.0.0.1:4311/__prd-review/index.html"),
  );
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
