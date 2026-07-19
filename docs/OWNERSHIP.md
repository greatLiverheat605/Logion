# Phase 0 所有权与共享契约

在配置 GitHub CODEOWNERS 前，本文件是等价所有权记录。

| 资产                               | Owner 角色              | 并发规则                     |
| ---------------------------------- | ----------------------- | ---------------------------- |
| 根配置、锁文件、工作区清单         | Coordinator             | 单写者                       |
| OpenAPI、错误码、事件与同步 schema | Contract owner          | 先合并 contract PR           |
| Alembic 迁移序列                   | Database contract owner | 同时只能有一个 head writer   |
| IndexedDB schema                   | Offline contract owner  | 同时只能有一个 schema writer |
| 权限注册表                         | Authorization owner     | 变更需安全复核               |
| CI、镜像、部署和备份               | Platform owner          | 发布需人类批准               |

GitHub 所有权已绑定为 `@greatLiverheat605`，对应规则位于 `.github/CODEOWNERS`。CODEOWNERS 只有在远程仓库启用分支保护、要求代码所有者审查后才构成强制门禁；本地文件本身不能替代平台设置。
