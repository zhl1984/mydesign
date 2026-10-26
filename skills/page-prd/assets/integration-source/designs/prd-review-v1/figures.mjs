import { markdownToHtml, escapeHtml, flowSource } from "./document.mjs";
const $ = (id) => document.getElementById(id);
let enginePromise;
let serial = 0;

/** 首次展示图表时才加载本地Mermaid，正文或业务页不依赖远程CDN。 */
async function engine() {
  if (!enginePromise)
    enginePromise = import("./vendor/mermaid.esm.min.mjs")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: {
            primaryColor: "#edf4ff",
            primaryTextColor: "#1f2329",
            primaryBorderColor: "#91caff",
            lineColor: "#8fa4c0",
            tertiaryColor: "#fafbfc",
          },
          fontFamily: "PingFang SC,Microsoft YaHei,sans-serif",
        });
        return mermaid;
      })
      .catch((error) => {
        enginePromise = null;
        throw error;
      });
  return enginePromise;
}

/** 安全模式解析和渲染；错误返回调用方，不在文档中插入错误SVG。 */
async function render(source) {
  const mermaid = await engine();
  await mermaid.parse(source);
  return (await mermaid.render("prd-mermaid-" + ++serial, source)).svg;
}

/** 图表SVG与原始Markdown分离，只有源码参与保存。 */
export async function paintFigures(root, isOpen) {
  if (!isOpen()) return;
  for (const figure of root.querySelectorAll('[data-language="mermaid"]')) {
    const target = figure.querySelector(".prd-diagram-view");
    if (!target || figure.dataset.rendered === figure.dataset.source) continue;
    const source = figure.dataset.source;
    try {
      const svg = await render(source);
      if (!isOpen() || !figure.isConnected || figure.dataset.source !== source)
        continue;
      target.innerHTML = svg;
      figure.dataset.rendered = source;
    } catch (error) {
      if (isOpen() && figure.isConnected)
        target.textContent = "图表无法渲染：" + error.message;
    }
  }
}

/** 图表弹窗内源码与预览并排；正文始终保持原位编辑。 */
export function mountFigures({
  editable,
  insert,
  changed,
  rememberSelection,
  toast,
  imageEndpoint = "/images",
}) {
  let selected = null,
    previewToken = 0,
    previewTimer;
  const isEditing = () => editable() && !$("prd-panel").hidden;
  async function preview() {
    const token = ++previewToken;
    $("diagram-save").disabled = true;
    $("diagram-error").textContent = "";
    $("diagram-preview").textContent = "渲染中…";
    try {
      const svg = await render($("diagram-source").value);
      if (token !== previewToken || !$("diagram-dialog").open) return;
      $("diagram-preview").innerHTML = svg;
      $("diagram-save").disabled = !isEditing();
    } catch (error) {
      if (token !== previewToken) return;
      $("diagram-preview").textContent = "请检查图表语法";
      $("diagram-error").textContent = error.message;
    }
  }
  /** 保存光标，插入和编辑共用一个弹窗且允许取消而不改正文。 */
  function open(source, node = null) {
    if (!isEditing()) return;
    rememberSelection();
    $("insert-menu").hidden = true;
    $("figure-tools").hidden = true;
    selected = node;
    $("diagram-title").textContent = node ? "编辑图表" : "插入图表";
    $("diagram-source").value = source;
    $("diagram-save").textContent = node ? "应用修改" : "插入图表";
    $("diagram-dialog").showModal();
    preview();
  }
  $("insert-flow").addEventListener("click", () => open(flowSource));
  $("insert-architecture").addEventListener("click", () =>
    open(
      "flowchart LR\nA[本地设计与Markdown] --> B[Git合并发布]\nB --> C[测试环境只读正文]\nD[独立评论服务] --- C",
    ),
  );
  $("diagram-source").addEventListener("input", () => {
    clearTimeout(previewTimer);
    ++previewToken;
    $("diagram-save").disabled = true;
    previewTimer = setTimeout(preview, 350);
  });
  $("diagram-dialog").addEventListener("close", () => {
    clearTimeout(previewTimer);
    ++previewToken;
  });
  $("diagram-save").addEventListener("click", () => {
    if (!isEditing() || $("diagram-save").disabled) return;
    const html = markdownToHtml(
      "```mermaid\n" + $("diagram-source").value + "\n```",
    );
    // 先关闭模态弹窗解除正文inert，否则浏览器会拒绝恢复光标及插入内容。
    $("diagram-dialog").close();
    if (selected) {
      selected.outerHTML = html;
      changed();
    } else insert(html + "<p><br></p>");
    paintFigures($("document"), () => !$("prd-panel").hidden);
  });
  function zoom(node) {
    $("zoom-content").replaceChildren(node.cloneNode(true));
    $("zoom-dialog").showModal();
    $("figure-tools").hidden = true;
  }
  $("document").addEventListener("click", (event) => {
    const node = event.target.closest('[data-language="mermaid"],img');
    if (!node) {
      $("figure-tools").hidden = true;
      return;
    }
    selected = node;
    const box = node.getBoundingClientRect();
    $("figure-tools").hidden = false;
    $("figure-tools").style.left = Math.min(box.left, innerWidth - 180) + "px";
    $("figure-tools").style.top =
      Math.max(8, Math.min(box.top, innerHeight - 45)) + "px";
    $("figure-edit").hidden = !isEditing() || node.tagName === "IMG";
    $("figure-delete").hidden = !isEditing();
  });
  $("figure-edit").addEventListener("click", () =>
    open(selected.dataset.source, selected),
  );
  $("figure-delete").addEventListener("click", () => {
    if (!isEditing()) return;
    selected.remove();
    $("figure-tools").hidden = true;
    changed();
  });
  $("figure-zoom").addEventListener("click", () => zoom(selected));
  $("document").addEventListener("dblclick", (event) => {
    const node = event.target.closest('[data-language="mermaid"],img');
    if (!node) return;
    if (isEditing() && node.tagName !== "IMG") open(node.dataset.source, node);
    else zoom(node);
  });
  $("insert-image").addEventListener("click", () => {
    rememberSelection();
    $("image-file").click();
  });
  $("image-file").addEventListener("change", async () => {
    const file = $("image-file").files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast("图片大小不能超过5MB");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = "";
      for (let i = 0; i < bytes.length; i += 32768)
        text += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const response = await fetch(imageEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: file.type, data: btoa(text) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      if (!isEditing()) throw new Error("图片已保存，请返回编辑后重新插入");
      insert(
        '<p><img alt="' +
          escapeHtml(file.name) +
          '" src="' +
          escapeHtml(result.url) +
          '"></p><p><br></p>',
      );
    } catch (error) {
      toast(error.message);
    } finally {
      $("image-file").value = "";
    }
  });
  return {
    clear: () => {
      $("figure-tools").hidden = true;
    },
  };
}
