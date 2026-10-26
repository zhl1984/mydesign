/** 首版只支持界面中开放的Markdown结构；复杂代码块保留源码，不冒充通用编辑器。 */
export const flowSource =
  "flowchart TD\nA[填写手机号] --> B[校验位数与号段]\nB --> C[查询注册状态]\nC --> D[获取验证码]\nD --> E[填写验证码并登录]";

/** 所有正文先转义，文档不是可执行HTML。 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 限制图片和链接协议，避免编辑文档引入可执行地址。 */
function safeUrl(value) {
  return /^(https?:\/\/|\.\.?\/|\/|#)/.test(value) ? escapeHtml(value) : "#";
}

/** 转换已开放的行内格式，链接和图片仅接受安全地址。 */
function inline(value) {
  return escapeHtml(value)
    .replace(
      /!\[([^\]]*)\]\(([^\s)]+)\)/g,
      (_, alt, url) => `<img alt="${alt}" src="${safeUrl(url)}">`,
    )
    .replace(
      /\[([^\]]+)\]\(([^\s)]+)\)/g,
      (_, label, url) =>
        `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${label}</a>`,
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/ {2}\n/g, "<br>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n/g, " ");
}

/** 图表源码独立保留，SVG由按需加载的Mermaid渲染，不参与正文序列化。 */
function fence(language, source) {
  const attributes = `data-language="${escapeHtml(language)}" data-source="${escapeHtml(source)}" contenteditable="false" tabindex="0"`;
  if (language === "mermaid")
    return `<figure class="prd-diagram" ${attributes}><div class="prd-diagram-view" aria-label="Mermaid图表">图表加载中…</div></figure>`;
  return `<figure class="prd-code" ${attributes}><figcaption>${escapeHtml(language || "代码")}</figcaption><pre><code>${escapeHtml(source)}</code></pre></figure>`;
}

/** 将独立Markdown渲染为整篇可编辑正文，保留段落和表格结构。 */
export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i++]);
      i++;
      blocks.push(fence(language, code.join("\n")));
      continue;
    }
    const heading = line.match(/^(#{1,6}) (.*)/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith("|") && /^\|[\s:|-]+\|$/.test(lines[i + 1] || "")) {
      const cells = (row) =>
        row
          .trim()
          .slice(1, -1)
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim().replace(/\\\|/g, "|"));
      const headers = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|"))
        rows.push(cells(lines[i++]));
      blocks.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    const list = line.match(/^(?:([-*])|(\d+)\.) (.*)/);
    if (list) {
      const tag = list[2] ? "ol" : "ul";
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(
          tag === "ol" ? /^\d+\. (.*)/ : /^[-*] (.*)/,
        );
        if (!item) break;
        items.push(`<li>${inline(item[1])}</li>`);
        i++;
      }
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      i++;
      continue;
    }
    const paragraph = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6} |[-*] |\d+\. |```|\||> )/.test(lines[i])
    )
      paragraph.push(lines[i++]);
    blocks.push(`<p>${inline(paragraph.join("\n"))}</p>`);
  }
  return blocks.join("\n");
}

/** 行内序列化保留Shift+Enter产生的软换行，不使用textContent压平段落。 */
function inlineMarkdown(node) {
  if (node.nodeType === 3) return node.textContent.replace(/\u00a0/g, " ");
  if (node.nodeType !== 1) return "";
  const tag = node.tagName;
  if (tag === "BR") return "  \n";
  const text = Array.from(node.childNodes).map(inlineMarkdown).join("");
  if (tag === "STRONG" || tag === "B") return `**${text}**`;
  if (tag === "EM" || tag === "I") return `*${text}*`;
  if (tag === "CODE") return "`" + text + "`";
  if (tag === "IMG")
    return `![${node.getAttribute("alt") || ""}](${node.getAttribute("src") || ""})`;
  if (tag === "A") return `[${text}](${node.getAttribute("href") || ""})`;
  return text;
}

/** 整篇编辑DOM写回Markdown，图表与代码原始源码直接保留。 */
export function htmlToMarkdown(root) {
  const block = (node) => {
    if (node.nodeType === 3) return node.textContent.trim();
    if (node.nodeType !== 1) return "";
    if (node.hasAttribute("data-source"))
      return (
        "```" + node.dataset.language + "\n" + node.dataset.source + "\n```"
      );
    if (node.tagName === "TABLE") {
      const rows = Array.from(node.querySelectorAll("tr")).map(
        (row) =>
          "| " +
          Array.from(row.children)
            .map((cell) =>
              inlineMarkdown(cell)
                .trim()
                .replace(/\|/g, "\\|")
                .replace(/\n/g, "<br>"),
            )
            .join(" | ") +
          " |",
      );
      if (rows.length)
        rows.splice(
          1,
          0,
          "| " +
            Array.from(node.querySelector("tr").children)
              .map(() => "---")
              .join(" | ") +
            " |",
        );
      return rows.join("\n");
    }
    if (node.tagName === "UL" || node.tagName === "OL")
      return Array.from(node.children)
        .map(
          (item, i) =>
            `${node.tagName === "OL" ? i + 1 + "." : "-"} ${inlineMarkdown(item).trim()}`,
        )
        .join("\n");
    if (
      node.tagName === "DIV" &&
      node.querySelector("p,div,table,ul,ol,figure")
    )
      return Array.from(node.childNodes)
        .map(block)
        .filter(Boolean)
        .join("\n\n");
    const text = inlineMarkdown(node)
      .replace(/(?: {2}\n)+$/, "")
      .trim();
    if (/^H[1-6]$/.test(node.tagName))
      return "#".repeat(Number(node.tagName[1])) + " " + text;
    if (node.tagName === "BLOCKQUOTE") return "> " + text;
    return text;
  };
  return (
    Array.from(root.childNodes).map(block).filter(Boolean).join("\n\n") + "\n"
  );
}
