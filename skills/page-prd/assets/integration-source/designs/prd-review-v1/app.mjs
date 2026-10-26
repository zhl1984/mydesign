import {
  markdownToHtml,
  htmlToMarkdown,
  escapeHtml as esc,
} from "./document.mjs";
import { directoryFor, findPage, createFileSession } from "./state.mjs";
import { mountComments } from "./comments.mjs";
import { mountFigures, paintFigures } from "./figures.mjs";
const $ = (id) => document.getElementById(id);
const shell = document.querySelector(".pr-shell");
const embedded = new URLSearchParams(location.search).get("embedded") === "1";
const {
  pages,
  revisions = {},
  runtime = {},
} = await (await fetch("./manifest.json")).json();
const editableRuntime = runtime.editable !== false;
const dataBase = embedded ? new URL("./", location.href).pathname : "/";
if (embedded) {
  shell.classList.add("pr-shell--embedded");
  document.body.classList.add("pr-embedded");
  $("page-frame").remove();
}
/** 只向同源宿主报告状态，不改变地址栏或父级业务路由。 */
function notifyHost(type, payload = {}) {
  if (embedded)
    parent.postMessage(
      { source: "page-prd", type, ...payload },
      location.origin,
    );
}
const initialPath =
  new URLSearchParams(location.search).get("page") || pages[0]?.path;
const initial = findPage(pages, initialPath) || pages[0];
const state = {
  actual: initial.id,
  actualPath: initialPath,
  page: initial.id,
  editing: false,
  review:
    !editableRuntime ||
    new URLSearchParams(location.search).get("review") === "1",
  revisions: false,
};
let saveTimer,
  toastTimer,
  range,
  quote = "",
  loading = 0;
const file = createFileSession(write, updateChrome);
const comments = mountComments(
  () => ({ page: state.page, version: file.version }),
  toast,
);
const figures = mountFigures({
  editable: () => state.editing && !state.review,
  insert,
  changed,
  rememberSelection,
  toast,
  imageEndpoint: dataBase + "images",
});
if (!embedded) $("page-frame").src = initial.path;

/** 仅本地写入已登记Markdown，服务端再次检查来源及文件版本。 */
async function write(id, content, version) {
  if (!editableRuntime)
    throw new Error("测试环境正文只读，请在本地修改并提交发布");
  const response = await fetch(dataBase + "documents/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, version }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.message || "文件保存失败"), {
      status: response.status,
    });
  return result;
}

/** 反馈不会把本地演示说成共享团队服务。 */
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4000);
}

/** 当前功能由实际页面限定，正文选择与真实路由独立。 */
function updateChrome() {
  const page = pages.find((item) => item.id === state.page);
  const actual = pages.find((item) => item.id === state.actual);
  $("document-title").textContent = (actual?.module || "功能") + " PRD";
  $("file-path").textContent = page?.file || "未配置文档";
  $("version-label").textContent = file.version
    ? "文件版本 " + file.version.slice(0, 7)
    : "";
  $("save-status").textContent = file.saving
    ? "保存中…"
    : file.conflict
      ? "版本冲突"
      : file.error
        ? "保存失败"
        : file.dirty
          ? "未保存"
          : file.version
            ? "已保存"
            : "";
  $("save-status").classList.toggle("is-error", !!file.error);
  $("save-status").title =
    file.error ||
    (file.dirty ? "修改尚未写入文件" : "正文已与本地Markdown文件同步");
  $("document").contentEditable =
    state.editing && !state.review && !state.revisions ? "true" : "false";
  $("document").hidden = !actual || state.revisions;
  $("document").classList.toggle("pr-document--root", !!page && !page.parent);
  $("revisions").hidden = !actual || !state.revisions;
  $("unmatched").hidden = !!actual;
  $("review-tip").hidden = !state.review;
  $("edit").disabled = !actual || state.review || state.revisions;
  $("edit").innerHTML = icon(state.editing ? "check" : "edit");
  $("edit").title = state.editing ? "完成编辑" : "编辑文档";
  $("edit").setAttribute("aria-label", $("edit").title);
  $("insert-toggle").hidden = !state.editing || state.review || state.revisions;
  $("source-open").disabled = !actual || state.review || state.revisions;
  $("source-apply").disabled = state.review;
  $("comments-toggle").disabled = !actual;
  $("retry-save").hidden = !file.error || file.conflict;
  $("review-mode").checked = state.review;
  $("review-mode").disabled = !editableRuntime;
  $("directory").innerHTML = directoryFor(pages, state.actual)
    .map(
      ({ page, number, depth }) =>
        `<button class="pr-nav-item${!state.revisions && page.id === state.page ? " is-active" : ""}" data-page="${esc(page.id)}"${!state.revisions && page.id === state.page ? ' aria-current="page"' : ""} title="${esc(number + " " + page.name)}" style="padding-left:${10 + depth * 12}px"><span class="pr-nav-number">${number}</span><span class="pr-nav-label">${esc(page.name)}</span></button>`,
    )
    .join("");
  // 历史沿用原功能PRD，本次只维护正文，不因切换或编辑自动新增。
  const history = revisions[actual?.module] || [];
  $("revisions").innerHTML =
    "<h2>修订记录</h2>" +
    (history.length
      ? "<table><thead><tr><th>日期</th><th>修改内容</th></tr></thead><tbody>" +
        history
          .map(
            (row) =>
              "<tr><td>" +
              esc(row.date) +
              "</td><td>" +
              esc(row.content) +
              "</td></tr>",
          )
          .join("") +
        "</tbody></table>"
      : "<p>暂无修订记录</p>");
  $("revision-entry").hidden = !actual;
  $("revision-entry").classList.toggle("is-active", state.revisions);
}

/** 编辑时只收集内容，不重画正文以保留光标、原生撤销和输入法状态。 */
function changed() {
  file.change(htmlToMarkdown($("document")));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => file.save(), 900);
  comments.refresh();
}

/** 跳转/退出编辑前等待完整保存；失败时保留当前编辑和可下载内容。 */
async function flush() {
  clearTimeout(saveTimer);
  const saved = await file.save();
  if (!saved) toast(file.error || "修改尚未保存，请重试或下载Markdown备份");
  return saved;
}

/** 只切文档不切业务路由；异步读取使用序号，避免快速切换错配正文。 */
async function loadPage(id) {
  if (!(await flush())) return false;
  const ticket = ++loading;
  try {
    const response = await fetch(
      dataBase + "documents/" + id + (embedded ? ".json" : ""),
    );
    if (!response.ok) throw new Error("读取文档失败");
    const result = await response.json();
    if (ticket !== loading) return false;
    state.page = id;
    state.editing = false;
    state.revisions = false;
    range = null;
    file.reset(id, result.content, result.version);
    $("document").innerHTML = markdownToHtml(result.content);
    $("document-scroll").scrollTop = 0;
    updateChrome();
    comments.refresh();
    hideFloating();
    paintFigures($("document"), () => !$("prd-panel").hidden);
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

/** 收起不销毁iframe或业务DOM，业务草稿与滚动位置保持。 */
function setOpen(open) {
  notifyHost("visibility", { open });
  shell.classList.toggle("pr-shell--collapsed", !open);
  $("prd-panel").hidden = !open;
  $("open-panel").hidden = open;
  hideFloating();
  $("insert-menu").hidden = true;
  $("more-menu").hidden = true;
  if (!open) {
    $("review-panel").hidden = true;
    document
      .querySelectorAll("dialog[open]")
      .forEach((dialog) => dialog.close());
    clearTimeout(saveTimer);
    file.save();
  } else paintFigures($("document"), () => !$("prd-panel").hidden);
}

/** 暂存光标，工具按钮或弹窗不会使插入位置丢失。 */
function rememberSelection() {
  const selected = window.getSelection();
  if (selected.rangeCount && $("document").contains(selected.anchorNode))
    range = selected.getRangeAt(0).cloneRange();
}

/** 通过原生编辑命令保留撤销链；无可用光标时插入正文末尾。 */
function restoreSelection() {
  $("document").focus();
  if (!range || !$("document").contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents($("document"));
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 新增图表和图片直接写入当前正文，随后按同一保存机制落盘。 */
function insert(html) {
  if (!state.editing || state.review) return;
  restoreSelection();
  document.execCommand("insertHTML", false, html);
  rememberSelection();
  changed();
  $("insert-menu").hidden = true;
}

/** 简洁的上下文格式操作，不再创建第二套编辑器界面。 */
function format(action) {
  if (!state.editing || state.review) return;
  restoreSelection();
  if (action === "bold") document.execCommand("bold");
  if (action === "h2" || action === "h3")
    document.execCommand("formatBlock", false, action);
  if (action === "list") document.execCommand("insertUnorderedList");
  if (action === "table")
    return insert(
      "<table><thead><tr><th>字段</th><th>规则</th></tr></thead><tbody><tr><td>名称</td><td>填写规则</td></tr></tbody></table><p><br></p>",
    );
  rememberSelection();
  changed();
  hideFloating();
  $("insert-menu").hidden = true;
}

/** 选文工具只有正文内选区才显示，收起后不留下任何批注效果。 */
function captureSelection() {
  if ($("prd-panel").hidden) return;
  const selection = window.getSelection();
  if (!selection.rangeCount || !$("document").contains(selection.anchorNode))
    return;
  rememberSelection();
  quote = selection.toString().trim();
  $("selection-tools").hidden = !quote;
  if (!quote) return;
  const rect = range.getBoundingClientRect();
  $("selection-tools").style.left =
    Math.min(rect.left, innerWidth - 160) + "px";
  $("selection-tools").style.top =
    Math.min(rect.bottom + 8, innerHeight - 44) + "px";
  $("selection-bold").hidden = !state.editing || state.review;
}

/** 不注入业务页标记；外层浮动工具关闭后不能遮挡真实页面。 */
function hideFloating() {
  $("selection-tools").hidden = true;
  figures.clear();
}

/** 平台现有线性图标风格，全部图标按钮提供无障碍名称。 */
function icon(name) {
  const paths = {
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    directory: '<path d="M4 5h16M4 12h16M4 19h16"/>',
    insert: '<path d="M12 5v14M5 12h14"/>',
    comments:
      '<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    collapse:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m-8-11 3 3-3 3"/>',
  };
  return (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    paths[name] +
    "</svg>"
  );
}
for (const [id, name] of [
  ["directory-toggle", "directory"],
  ["insert-toggle", "insert"],
  ["more-toggle", "more"],
  ["collapse", "collapse"],
])
  $(id).innerHTML = icon(name);
$("comments-toggle").insertAdjacentHTML("afterbegin", icon("comments"));
$("directory-toggle").addEventListener("click", () => {
  const panel = $("directory-panel");
  panel.hidden = !panel.hidden;
  $("directory-toggle").title = panel.hidden ? "展开目录" : "收起目录";
  $("directory-toggle").setAttribute("aria-label", $("directory-toggle").title);
});
$("directory").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (button) loadPage(button.dataset.page);
});
$("revision-entry").addEventListener("click", async () => {
  if (!(await flush())) return;
  state.editing = false;
  state.revisions = true;
  hideFloating();
  updateChrome();
});
$("edit").addEventListener("click", async () => {
  if (state.editing && !(await flush())) return;
  state.editing = !state.editing;
  range = null;
  hideFloating();
  updateChrome();
});
$("document").addEventListener("input", changed);
$("document").addEventListener("paste", (event) => {
  if (!state.editing) return;
  event.preventDefault();
  document.execCommand(
    "insertText",
    false,
    event.clipboardData.getData("text/plain"),
  );
  changed();
});
$("document").addEventListener("mouseup", captureSelection);
$("document").addEventListener("keyup", captureSelection);
$("selection-comment").addEventListener("click", () => {
  comments.open(quote);
  hideFloating();
});
document.querySelectorAll("[data-format]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => format(button.dataset.format));
});
$("insert-toggle").addEventListener("mousedown", (event) => {
  event.preventDefault();
  rememberSelection();
});
$("insert-toggle").addEventListener("click", () => {
  $("insert-menu").hidden = !$("insert-menu").hidden;
  $("more-menu").hidden = true;
});
$("more-toggle").addEventListener("click", () => {
  $("more-menu").hidden = !$("more-menu").hidden;
  $("insert-menu").hidden = true;
});
$("collapse").addEventListener("click", () => setOpen(false));
$("retry-save").addEventListener("click", () => flush());
$("source-open").addEventListener("click", () => {
  $("markdown-source").value = file.content;
  $("source-dialog").showModal();
  $("more-menu").hidden = true;
});
$("source-apply").addEventListener("click", () => {
  if (state.review) return;
  const content = $("markdown-source").value;
  if (content !== file.content) {
    file.change(content);
    $("document").innerHTML = markdownToHtml(content);
    range = null;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => file.save(), 900);
    comments.refresh();
    paintFigures($("document"), () => !$("prd-panel").hidden);
  }
  $("source-dialog").close();
});
$("review-mode").addEventListener("change", async () => {
  if (!(await flush())) {
    $("review-mode").checked = state.review;
    $("review-mode").disabled = !editableRuntime;
    return;
  }
  state.review = $("review-mode").checked;
  state.editing = false;
  hideFloating();
  updateChrome();
});
$("export").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([file.content], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = (state.page || "prd") + ".md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () => $(button.dataset.close).close()),
  );
$("document-scroll").addEventListener("scroll", hideFloating);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideFloating();
    $("insert-menu").hidden = true;
    $("more-menu").hidden = true;
  }
});
window.addEventListener("beforeunload", (event) => {
  if (file.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

/** 业务导航来自真实页面；只观察路由，不修改平台样式或登录逻辑。 */
async function syncRoute(pathFromHost) {
  if (embedded && typeof pathFromHost !== "string") return;
  try {
    const path = embedded
      ? pathFromHost
      : $("page-frame").contentWindow.location.pathname;
    const page = findPage(pages, path);
    const id = page?.id || null;
    if (id === state.actual && path === state.actualPath) return;
    if (!(await flush())) return;
    state.actual = id;
    state.actualPath = path;
    state.editing = false;
    state.revisions = false;
    $("review-panel").hidden = true;
    hideFloating();
    if (page) await loadPage(page.id);
    else {
      updateChrome();
      $("directory").innerHTML = "";
    }
  } catch (error) {
    toast("无法读取页面路由：" + error.message);
  }
}
if (!embedded) {
  $("page-frame").addEventListener("load", () => syncRoute());
  setInterval(() => syncRoute(), 700);
} else
  window.addEventListener("message", (event) => {
    // iframe只接收当前同源父窗口的上下文，不接受其他窗口发起的导航。
    if (
      event.source !== parent ||
      event.origin !== location.origin ||
      event.data?.source !== "page-prd-host"
    )
      return;
    if (event.data.type === "context" && typeof event.data.path === "string")
      syncRoute(event.data.path);
    if (
      event.data.type === "visibility" &&
      typeof event.data.open === "boolean"
    )
      setOpen(event.data.open);
  });

/** 目录独立调宽并限制正文最小可用空间；切页及目录收起不重置宽度。 */
let directoryWidth = 180;
function resizeDirectory(value) {
  const available = $("prd-panel").clientWidth || innerWidth;
  const maximum = Math.max(120, Math.min(360, available * 0.45));
  directoryWidth = Math.max(120, Math.min(maximum, value));
  $("directory-panel").style.width = directoryWidth + "px";
  $("directory-resizer").setAttribute("aria-valuemin", "120");
  $("directory-resizer").setAttribute(
    "aria-valuemax",
    String(Math.round(maximum)),
  );
  $("directory-resizer").setAttribute(
    "aria-valuenow",
    String(Math.round(directoryWidth)),
  );
}
const directorySeparator = $("directory-resizer");
let directoryStartX = 0,
  directoryStartWidth = directoryWidth;
directorySeparator.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  directoryStartX = event.clientX;
  directoryStartWidth = directoryWidth;
  directorySeparator.setPointerCapture(event.pointerId);
  shell.classList.add("pr-shell--directory-resizing");
});
directorySeparator.addEventListener("pointermove", (event) => {
  if (directorySeparator.hasPointerCapture(event.pointerId))
    resizeDirectory(directoryStartWidth + event.clientX - directoryStartX);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  directorySeparator.addEventListener(type, () =>
    shell.classList.remove("pr-shell--directory-resizing"),
  );
directorySeparator.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  resizeDirectory(directoryWidth + (event.key === "ArrowRight" ? 20 : -20));
});
// 业务侧栏或窗口缩小时约束目录，避免之前拖宽的目录占满正文。
if (typeof ResizeObserver !== "undefined")
  new ResizeObserver(() => resizeDirectory(directoryWidth)).observe(
    $("prd-panel"),
  );
window.addEventListener("resize", () => resizeDirectory(directoryWidth));
resizeDirectory(directoryWidth);

/** 展开宽度仅影响业务可用视口；隐藏时iframe无边框、无间距、完整铺满。 */
let width = 720;
function resizePanel(value) {
  width = Math.max(360, Math.min(innerWidth * 0.6, value));
  shell.style.setProperty("--pr-panel-width", width + "px");
}
const separator = $("panel-resizer");
separator.addEventListener("pointerdown", (event) => {
  separator.setPointerCapture(event.pointerId);
  shell.classList.add("pr-shell--resizing");
});
separator.addEventListener("pointermove", (event) => {
  if (separator.hasPointerCapture(event.pointerId))
    resizePanel(innerWidth - event.clientX);
});
separator.addEventListener("pointerup", () =>
  shell.classList.remove("pr-shell--resizing"),
);
separator.addEventListener("pointercancel", () =>
  shell.classList.remove("pr-shell--resizing"),
);
separator.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    resizePanel(width + (event.key === "ArrowLeft" ? 20 : -20));
  }
});
window.addEventListener("resize", () => resizePanel(width));
resizePanel(width);

/** 悬浮入口只记位置偏好；拖动松手不触发展开，键盘可上下移动。 */
const tab = $("open-panel");
let dragStart = 0,
  originTop = 0,
  moved = false,
  tabTop = innerHeight * 0.44;
try {
  tabTop = Number(localStorage.getItem("prd-review-entry-top")) || tabTop;
} catch {
  /* 浏览器不允许偏好存储时使用默认位置。 */
}
function positionTab(value) {
  tabTop = Math.max(8, Math.min(innerHeight - 64, value));
  tab.style.top = tabTop + "px";
}
function saveTabPosition() {
  try {
    localStorage.setItem("prd-review-entry-top", String(tabTop));
  } catch {
    /* 位置偏好失败不影响PRD编辑和正文文件保存。 */
  }
}
positionTab(tabTop);
tab.addEventListener("pointerdown", (event) => {
  dragStart = event.clientY;
  originTop = tabTop;
  moved = false;
  tab.setPointerCapture(event.pointerId);
});
tab.addEventListener("pointermove", (event) => {
  if (!tab.hasPointerCapture(event.pointerId)) return;
  if (Math.abs(event.clientY - dragStart) > 4) moved = true;
  if (moved) positionTab(originTop + event.clientY - dragStart);
});
tab.addEventListener("pointerup", () => {
  if (moved) saveTabPosition();
});
tab.addEventListener("click", () => {
  if (moved) {
    moved = false;
    return;
  }
  setOpen(true);
});
tab.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    positionTab(tabTop + (event.key === "ArrowUp" ? -20 : 20));
    saveTabPosition();
  }
});
window.addEventListener("resize", () => positionTab(tabTop));
await loadPage(initial.id);
if (embedded) {
  setOpen(true);
  notifyHost("ready");
}
