/** 静态路径与别名优先；动态参数只占一个路径段，不改任何业务路由。 */
export function findPage(pages, path) {
  const clean = (value) =>
    new URL(value, "http://localhost").pathname.replace(/\/+$/, "") || "/";
  const actual = clean(path);
  const paths = (page) => [page.path, ...(page.aliases || [])];
  const exact = pages.find((page) =>
    paths(page).some((pattern) => clean(pattern) === actual),
  );
  if (exact) return exact;
  return (
    pages.find((page) =>
      paths(page).some((pattern) => {
        const parts = clean(pattern).split("/"),
          values = actual.split("/");
        return (
          parts.length === values.length &&
          parts.every((part, i) =>
            part.startsWith(":") ? Boolean(values[i]) : part === values[i],
          )
        );
      }),
    ) || null
  );
}

/** 当前真实页面决定功能范围，目录按登记的父子关系编号。 */
export function directoryFor(pages, actualId) {
  const actual = pages.find((page) => page.id === actualId);
  if (!actual) return [];
  const scoped = pages.filter((page) => page.module === actual.module);
  const result = [];
  const visit = (page, number, depth) => {
    result.push({ page, number, depth });
    scoped
      .filter((child) => child.parent === page.id)
      .forEach((child, i) => visit(child, `${number}.${i + 1}`, depth + 1));
  };
  scoped
    .filter((page) => !page.parent)
    .forEach((page, i) => visit(page, String(i + 1), 0));
  return result;
}

/** 磁盘保存会话串行提交快照；失败保留修改，冲突停止自动覆盖。 */
export function createFileSession(write, notify = () => {}) {
  let pending = null;
  const file = {
    id: "",
    content: "",
    version: "",
    dirty: false,
    saving: false,
    conflict: false,
    error: "",
    reset(id, content, version) {
      Object.assign(file, {
        id,
        content,
        version,
        dirty: false,
        conflict: false,
        error: "",
      });
      notify();
    },
    change(content) {
      file.content = content;
      file.dirty = true;
      notify();
    },
    save() {
      if (pending) return pending;
      if (!file.dirty || file.conflict) return Promise.resolve(!file.dirty);
      pending = (async () => {
        file.saving = true;
        file.error = "";
        notify();
        try {
          // 输入发生在请求期间时继续保存最新快照，不能误报“全部已保存”。
          while (file.dirty) {
            const snapshot = file.content;
            const response = await write(file.id, snapshot, file.version);
            file.version = response.version;
            file.dirty = file.content !== snapshot;
          }
          return true;
        } catch (error) {
          file.conflict = error.status === 409;
          file.error = error.message || "保存失败，请重试";
          return false;
        } finally {
          file.saving = false;
          pending = null;
          notify();
        }
      })();
      return pending;
    },
  };
  return file;
}
