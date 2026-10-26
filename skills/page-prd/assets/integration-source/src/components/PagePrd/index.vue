<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
} from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { hasPagePrd } from "./routes";

const route = useRoute();
const { t } = useI18n();
const frame = ref<HTMLIFrameElement>();
const opened = ref(false),
  created = ref(false),
  ready = ref(false),
  failed = ref(false);
const width = ref(720),
  top = ref(320);
let loadTimer: ReturnType<typeof setTimeout> | undefined;
let startY = 0,
  startTop = 0,
  moved = false;
const supported = computed(() => hasPagePrd(route.path));
const frameUrl = ref("");
const hostClass = computed(() => ({
  "pph-host--open": opened.value && supported.value,
  "pph-host--inactive": !supported.value,
}));
const hostStyle = computed<CSSProperties>(() => ({
  "--pph-width": `${width.value}px`,
  "--pph-entry-top": `${top.value}px`,
}));

/** 只通知文档当前路由，不调用router.push或修改真实页面。 */
function sendContext(): void {
  frame.value?.contentWindow?.postMessage(
    { source: "page-prd-host", type: "context", path: route.path },
    location.origin,
  );
}
/** 展开/收起保留文档窗口和原业务组件，防止表单草稿或编辑内容被重建。 */
function sendVisibility(): void {
  frame.value?.contentWindow?.postMessage(
    {
      source: "page-prd-host",
      type: "visibility",
      open: opened.value && supported.value,
    },
    location.origin,
  );
}
/** 首次点击才加载文档资源，默认浏览业务页不加载文档与Mermaid。 */
function handleOpen(): void {
  if (moved) {
    moved = false;
    return;
  }
  opened.value = true;
  if (!created.value) {
    frameUrl.value =
      import.meta.env.BASE_URL +
      "__page-prd/index.html?embedded=1&page=" +
      encodeURIComponent(route.path);
    created.value = true;
    startLoadTimer();
  } else sendVisibility();
}
/** 加载失败只影响文档，不阻塞业务页面、登录或导航。 */
function startLoadTimer(): void {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (!ready.value) failed.value = true;
  }, 12000);
}
/** 仅接受同源当前文档窗口发来的握手及收起消息。 */
function handleMessage(event: MessageEvent): void {
  if (
    event.origin !== location.origin ||
    event.source !== frame.value?.contentWindow
  )
    return;
  const data = event.data as {
    source?: string;
    type?: string;
    open?: boolean;
  } | null;
  if (!data || data.source !== "page-prd") return;
  if (data.type === "ready") {
    ready.value = true;
    failed.value = false;
    clearTimeout(loadTimer);
    sendContext();
    sendVisibility();
  } else if (data.type === "visibility" && data.open === false)
    opened.value = false;
}
/** 重试只刷新文档iframe，业务页与地址栏保持原状。 */
function handleRetry(): void {
  failed.value = false;
  ready.value = false;
  if (frame.value) frame.value.src = frameUrl.value;
  startLoadTimer();
}
/** 入口偏好只保存纵向位置，不持久化任何正文、业务或登录数据。 */
function clampPosition(value: number): number {
  return Math.max(8, Math.min(window.innerHeight - 62, value));
}
function handleResize(): void {
  width.value = Math.max(360, Math.min(width.value, innerWidth * 0.6));
  top.value = clampPosition(top.value);
}
/** 拖动捕获在入口按钮上，松手后的click不展开PRD。 */
function handleEntryDown(event: PointerEvent): void {
  startY = event.clientY;
  startTop = top.value;
  moved = false;
  (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
}
function handleEntryMove(event: PointerEvent): void {
  const button = event.currentTarget as HTMLButtonElement;
  if (!button.hasPointerCapture(event.pointerId)) return;
  if (Math.abs(event.clientY - startY) > 4) moved = true;
  if (moved) top.value = clampPosition(startTop + event.clientY - startY);
}
/** 存储不可用时保留当前会话内位置，不影响文档文件保存。 */
function savePosition(): void {
  try {
    localStorage.setItem("page-prd-entry-top", String(top.value));
  } catch {
    /* 浏览器禁用偏好存储时无需阻断业务操作。 */
  }
}
function handleEntryUp(): void {
  if (moved) savePosition();
}
/** 方向键支持不使用鼠标调整入口位置。 */
function handleEntryKey(event: KeyboardEvent): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  top.value = clampPosition(top.value + (event.key === "ArrowUp" ? -20 : 20));
  savePosition();
}
/** 调宽仅让出侧栏宽度，不修改业务页内部样式、路由或缩放。 */
function handlePanelDown(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function handlePanelMove(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId))
    width.value = Math.max(
      360,
      Math.min(innerWidth * 0.6, innerWidth - event.clientX),
    );
}
function handlePanelKey(event: KeyboardEvent): void {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    width.value = Math.max(
      360,
      Math.min(
        innerWidth * 0.6,
        width.value + (event.key === "ArrowLeft" ? 20 : -20),
      ),
    );
  }
}

// 文档跟随原路由；未知页关闭入口，已创建窗口保留以免丢失待保存内容。
watch(
  () => route.path,
  () => {
    if (!supported.value) opened.value = false;
    if (ready.value) {
      sendContext();
      sendVisibility();
    }
  },
);
onMounted(() => {
  top.value = clampPosition(innerHeight * 0.44);
  try {
    const saved = Number(localStorage.getItem("page-prd-entry-top"));
    if (saved) top.value = clampPosition(saved);
  } catch {
    /* 禁用偏好存储时沿用初始位置。 */
  }
  handleResize();
  window.addEventListener("message", handleMessage);
  window.addEventListener("resize", handleResize);
});
onBeforeUnmount(() => {
  clearTimeout(loadTimer);
  window.removeEventListener("message", handleMessage);
  window.removeEventListener("resize", handleResize);
});
</script>
<template>
  <div class="page-prd-host" :class="hostClass" :style="hostStyle">
    <div class="pph-page"><slot /></div>
    <aside
      v-show="opened && supported"
      class="pph-panel"
      :aria-label="t('pagePrd.document')"
    >
      <div
        class="pph-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('pagePrd.resize')"
        @pointerdown="handlePanelDown"
        @pointermove="handlePanelMove"
        @keydown="handlePanelKey"
      ></div>
      <iframe
        v-if="created"
        ref="frame"
        class="pph-frame"
        :src="frameUrl"
        :title="t('pagePrd.document')"
      ></iframe>
      <div v-if="!ready" class="pph-load-state">
        <span>{{ failed ? t("pagePrd.failed") : t("pagePrd.loading") }}</span
        ><button v-if="failed" type="button" @click="handleRetry">
          {{ t("pagePrd.retry") }}</button
        ><button type="button" @click="opened = false">
          {{ t("pagePrd.close") }}
        </button>
      </div>
    </aside>
    <button
      v-if="supported && !opened"
      class="pph-entry"
      type="button"
      :title="t('pagePrd.entryHint')"
      :aria-label="t('pagePrd.open')"
      @click="handleOpen"
      @pointerdown="handleEntryDown"
      @pointermove="handleEntryMove"
      @pointerup="handleEntryUp"
      @keydown="handleEntryKey"
    >
      PRD
    </button>
  </div>
</template>
<style scoped>
.page-prd-host {
  display: flex;
  width: 100%;
  height: 100vh;
  min-height: 0;
  gap: 0;
  margin: 0;
  padding: 0;
}
.pph-host--inactive,
.pph-host--inactive .pph-page {
  display: contents;
}
.pph-page {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: auto;
}
.pph-panel {
  position: relative;
  flex-shrink: 0;
  width: var(--pph-width);
  max-width: 60%;
  height: 100%;
  border-left: 1px solid var(--dm-border-color, #e8ebef);
  background: var(--dm-bg, #fff);
}
.pph-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.pph-entry {
  position: fixed;
  right: 0;
  top: var(--pph-entry-top);
  z-index: 1000;
  width: 28px;
  height: 54px;
  border: 0;
  padding: 8px 5px;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--ant-color-primary, #1677ff);
  font-size: 0.12rem;
  writing-mode: vertical-rl;
  touch-action: none;
  cursor: pointer;
}
.pph-entry:hover {
  background: transparent;
  color: var(--ant-color-primary, #1677ff);
}
.pph-entry:focus-visible {
  outline: 2px solid #91caff;
  outline-offset: -2px;
}
.pph-resizer {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 7px;
  z-index: 2;
  cursor: col-resize;
  touch-action: none;
}
.pph-resizer:hover {
  background: #1677ff20;
}
.pph-load-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--dm-bg, #fff);
  font-size: 0.13rem;
}
.pph-load-state button {
  border: 0;
  background: transparent;
  color: var(--ant-color-primary, #1677ff);
  cursor: pointer;
}
@media (max-width: 650px) {
  .pph-panel {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: 100%;
    z-index: 1001;
  }
  .pph-resizer {
    display: none;
  }
}
</style>
