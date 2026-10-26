# Mydesign · 页面旁功能 PRD

维护团队可安装的 `page-prd` 技能。当前版本：**2.0.0**。

## 能做什么

在真实业务页面旁维护独立 Markdown 功能 PRD，保持原业务地址、登录鉴权和页面布局。支持功能目录与页面关联、原位编辑自动保存、Mermaid 图表，以及正文和团队评审数据的发布边界说明。

工作流程：**修改页面 → 浏览器验证 → 验证确认通过 → 更新页面旁的 PRD → 按需导出**。

技能及可适配的 Vue/Vite 参考源码位于 [skills/page-prd](skills/page-prd)。安装技能只安装指导与资源，不自动修改业务项目或安装项目依赖；共享评论需要另行接入后端，参考实现中的评论为演示。

## 安装

使用 Skills CLI：

```sh
npx skills add zhl1984/mydesign --skill page-prd -g
```

如果已有旧版并希望自动备份、保留已有符号链接，可以克隆后使用包内安装器：

```sh
git clone https://github.com/zhl1984/mydesign.git
node mydesign/skills/page-prd/scripts/install.mjs --target ~/.codex/skills/page-prd
```

跨工具共用时，也可将目标改为 `~/.agents/skills/page-prd`。安装器会备份旧版并保留已有符号链接，安装后刷新技能列表或重启客户端。

固定版本及离线安装包见 [Releases](https://github.com/zhl1984/mydesign/releases)。ZIP 解压后运行其中 `page-prd/scripts/install.mjs`，按 `INSTALL.md` 指定目标。

## 使用

在支持技能的助手中调用 `$page-prd`，说明需要维护的页面、项目目录和本轮调整。已有集成优先增量维护；首次接入阅读 [集成指南](skills/page-prd/references/integration.md)。

“正式维护”与“是否记录修订”分别处理；要求不新增修订时，保留历史并正常更新正文。正文和图片随 Git 合并发布，测试环境只读；共享评论独立保存。

## 验证

仅需 Node.js；建议使用 Node.js 22 或更新的受支持版本。

```sh
node --test skills/page-prd/tests/*.node.mjs
node skills/page-prd/scripts/check-manifest.mjs skills/page-prd/assets/templates/manifest.json
```

检查覆盖绑定结构、非法父级与循环、动态路由冲突、模块导出及安装备份，不代替真实项目浏览器验收。
