# Page PRD skill · 2.0.0

`SKILL.md` 和 references/scripts 是可安装的团队技能。`assets/integration-source/` 是按本项目当前实现去除业务样例后的可审查参考源码，不会被安装器写入目标项目。

## 分享与安装

将 `page-prd-2.0.0.zip` 发给团队成员并解压，然后按目标助手选择技能目录。Codex 支持 `~/.codex/skills/page-prd`；跨工具共享可选 `~/.agents/skills/page-prd`。只选一个目标即可。

```sh
node /解压目录/page-prd/scripts/install.mjs --target ~/.codex/skills/page-prd
```

已有目标会先复制到 `~/.page-prd-backups/`，然后安装新版本；已有符号链接会保留并更新链接所指目录。命令输出会返回真实安装路径和备份路径。安装完成后重启或刷新技能列表。若目标不存在，直接创建。安装器要求明确目标，不会自动改个人目录。

## 验证与维护

```sh
node --test /解压目录/page-prd/tests/*.node.mjs
python3 /路径/到/skill-creator/scripts/quick_validate.py /解压目录/page-prd
```

团队维护以仓库 `skills/page-prd/` 为源；更新后重建 ZIP 并增加版本号。只分享 ZIP 不会推送项目仓库或发布代码。
