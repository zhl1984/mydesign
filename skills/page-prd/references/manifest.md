# Markdown 页面绑定

每页文件与稳定 id 一一对应，功能与目录单独登记。沿用项目已有位置；本项目为 `designs/prd-review-v1/manifest.json` 和 `documents/<id>.md`。

```json
{
  "pages": [
    {
      "id": "project-list",
      "name": "项目管理",
      "module": "项目管理",
      "path": "/project-management",
      "aliases": [],
      "parent": null,
      "file": "documents/project-list.md"
    },
    {
      "id": "project-create",
      "name": "新建项目",
      "module": "项目管理",
      "path": "/project-management/create",
      "aliases": [],
      "parent": "project-list",
      "file": "documents/project-create.md"
    }
  ],
  "revisions": { "项目管理": [] }
}
```

- `id` 唯一且稳定，使用小写英文、数字和连字符，不因页面名称修改而改变评论关联键。
- `name` 是真实目标页面名；`module` 决定侧栏范围，同一功能的全部页面同名归属。
- 每模块默认页 `parent: null`；子页引用真实入口页 id，同模块、无循环，不按 URL 深度计算。
- `path` 只声明文档匹配，不注册业务路由；静态路径及别名精确匹配优先，`:id` 仅匹配单段。别名复用同一节点。两个动态模式可同时命中时须明确分流，不能靠登记顺序掩盖歧义。
- 新标签工作台的 `path` 可与父页不在同一 URL 前缀，`parent` 仍指向其真实入口。不能凭名称为所有任务自动套同一工作台。
- 本参考实现使用 Router 的 pathname 匹配，query/hash 保留但不参与文档选择；若同一路径需要按 query 区分不同业务页，先设计匹配规则并测试，不虚构现有支持。Hash 路由应由宿主传入实际路由 path。
- `file` 相对 manifest。本参考本地保存服务按 id 查 `documents/<id>.md`，因此二者必须一致；若项目另有 file 映射，读写及构建必须统一适配。
- `requirementsPath` 可选，指向项目相对需求路径，不包含个人机器绝对路径。
- `revisions` 以模块名为键，条目为 `{ "date": "YYYY-MM-DD", "content": "具体调整" }`；修订不参与页面编号。
- `runtime.editable` 由运行环境产生，本地为 true，静态发布为 false，不由浏览器开关提升权限。用户“不新增修订”不通过伪造运行模式实现。

目录按 manifest 中同级登记顺序深度优先生成 `1 / 1.1 / 1.1.1 / 1.1.1.1`。当前文档与真实业务页面状态分开维护。工具检查父级、文件、章节与资源引用；真实路径是否存在、权限及命名仍需源码与浏览器核对。
