import { escapeHtml as esc } from "./document.mjs";
const $ = (id) => document.getElementById(id);
const comments = [];

/** 评论始终为当前页临时演示；独立于Markdown内容和文件保存。 */
export function mountComments(context, toast) {
  let filter = "open";
  let quote = "";
  let sequence = 10;
  function refresh() {
    const current = context();
    const items = comments.filter((item) => item.page === current.page);
    const open = items.filter((item) => !item.resolved).length;
    $("open-count").textContent = open;
    $("resolved-count").textContent = items.length - open;
    $("review-count").textContent = items.length;
    $("pending-count").textContent = open || "";
    document
      .querySelectorAll("[data-filter]")
      .forEach((button) =>
        button.classList.toggle("is-active", button.dataset.filter === filter),
      );
    const shown = items.filter(
      (item) => item.resolved === (filter === "resolved"),
    );
    const plain = $("document").textContent;
    $("comment-list").innerHTML = shown.length
      ? shown
          .map(
            (item) =>
              `<div class="pr-comment-card" data-comment="${item.id}"><div class="pr-comment-author"><span class="pr-avatar">${esc(item.avatar)}</span><strong>${esc(item.author)}<time>${esc(item.time)}</time></strong><button data-resolve="${item.id}" title="${item.resolved ? "重新打开" : "标记已解决"}" aria-label="${item.resolved ? "重新打开" : "标记已解决"}">${item.resolved ? "↺" : "✓"}</button></div>${item.quote ? `<div class="pr-comment-quote">${esc(item.quote)}${!plain.includes(item.quote) ? '<div class="pr-anchor-stale">原文已变更 · 保留原批注</div>' : ""}</div>` : ""}<p>${esc(item.text)}</p><div class="pr-comment-actions"><button data-reply="${item.id}">回复${item.replies.length ? " " + item.replies.length : ""}</button><span>${esc(item.version.slice(0, 7))}</span></div>${item.replies.map((reply) => `<div class="pr-comment-reply"><strong>${esc(reply.author)}</strong><time>${esc(reply.time)}</time><p>${esc(reply.text)}</p></div>`).join("")}<form data-reply-form="${item.id}" class="pr-reply-form" hidden><textarea aria-label="回复内容" placeholder="输入回复…" required></textarea><button class="pr-primary" type="submit">发送回复</button></form></div>`,
          )
          .join("")
      : '<div class="pr-empty">暂无' +
        (filter === "open" ? "待处理" : "已解决") +
        "评论</div>";
  }
  /** 展开仅影响PRD内部，不改变业务页面路由或正文。 */
  function open(selected = "") {
    quote = selected;
    $("review-panel").hidden = false;
    $("quote-preview").hidden = !quote;
    $("quote-preview").textContent = quote;
    document.querySelector('label[for="comment-input"]').textContent = quote
      ? "针对选中文字添加批注"
      : "添加整页评论";
    $("comment-input").focus();
  }
  $("comments-toggle").addEventListener("click", () => {
    if ($("review-panel").hidden) open();
    else $("review-panel").hidden = true;
  });
  $("close-comments").addEventListener("click", () => {
    $("review-panel").hidden = true;
  });
  $("new-comment").addEventListener("click", () => open());
  $("comment-input").addEventListener("input", () => {
    $("comment-submit").disabled = !$("comment-input").value.trim();
  });
  $("comment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("comment-input").value.trim();
    if (!text) return;
    const current = context();
    if (!current.page) return;
    comments.push({
      id: ++sequence,
      page: current.page,
      author: "产品 · 我",
      avatar: "我",
      time: "刚刚",
      version: current.version,
      quote,
      text,
      resolved: false,
      replies: [],
    });
    $("comment-input").value = "";
    $("comment-submit").disabled = true;
    quote = "";
    $("quote-preview").hidden = true;
    filter = "open";
    refresh();
    toast("演示评论已添加，未发送至团队");
  });
  $("comment-list").addEventListener("click", (event) => {
    const resolve = event.target.closest("[data-resolve]"),
      reply = event.target.closest("[data-reply]");
    if (resolve) {
      const item = comments.find(
        (item) => item.id === Number(resolve.dataset.resolve),
      );
      item.resolved = !item.resolved;
      refresh();
    }
    if (reply) {
      const form = document.querySelector(
        `[data-reply-form="${reply.dataset.reply}"]`,
      );
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector("textarea").focus();
    }
  });
  $("comment-list").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target.closest("[data-reply-form]");
    if (!form) return;
    const text = form.querySelector("textarea").value.trim();
    if (!text) return;
    comments
      .find((item) => item.id === Number(form.dataset.replyForm))
      .replies.push({ author: "产品 · 我", text, time: "刚刚" });
    refresh();
  });
  document.querySelectorAll("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      refresh();
    }),
  );
  return { refresh, open };
}
