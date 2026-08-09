# 当前状态（GLM 接手时点）

## 1. 真实基线

| 项目 | 当前值 |
| --- | --- |
| 仓库 | `greatLiverheat605/Logion` |
| 正式集成工作树 | `v020-integration` |
| 集成分支 | `codex/v020-integration` |
| 集成树交接前 HEAD | `26a1b24` |
| 远端 `main` | `2339002cd084950c3b859db561ade66fcfa528f4` |
| PR | [#202](https://github.com/greatLiverheat605/Logion/pull/202) |
| PR 状态 | 已合并（Rebase and merge） |
| PR 合并提交 | `2339002cd084950c3b859db561ade66fcfa528f4` |
| PR 检查 | `fast`、`integration`、`browser` 均成功 |
| 合并后工作流 | [Main candidate #31300835608](https://github.com/greatLiverheat605/Logion/actions/runs/31300835608)，`success` |

`codex/v020-integration` 与远端 `main` 是两个不同用途的分支：前者是协调/验收工作树，后者是已合并产品基线。开始新实现前必须由协调者确认目标基线和新分支，禁止直接在 `main` 或共享集成分支上并行写入。

## 2. 已合并的 UX 修复

PR #202 的两个提交为：

- `b850725`：工作区、空间和邀请表单增加中文就地反馈、加载状态、禁用和重复提交保护；搜索最短长度、本地口令错误、自定义画像名称校验增加明确提示；邀请 `INVITATION_CONFLICT/409` 映射为可行动中文提示。
- `7fc1d84`：补充 UX 修复状态文档。

修复包含 `aria-invalid`、`aria-describedby` 和 live region 关联；本轮未发送真实邀请，避免邮件副作用。

## 3. 产品与安全状态

当前不代表生产发布完成。以下能力继续保持默认关闭：

- Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance。
- 任何生产流量切换、真实邮件投递、生产迁移和发布动作。

V20-01～V20-14 的设计/实现/验收门已记录为通过；Main candidate 已按合并 SHA 成功完成。V20-15 仍需完成候选观察、真实受邀验收和用户发布授权，不能将候选 CI 通过等同于生产发布完成。

## 4. GLM 候选图内核的边界

GLM 曾交付过一个纯 Python、有界、无递归 BFS 图内核候选：42 个测试、Ruff lint/format、Mypy 均通过。它只处理调用方已经授权过滤后的字符串 ID 节点/边，支持无向 1/2 跳遍历、自环、多重边去重、150 节点/400 边硬上限和确定性冲突错误。

该候选没有正式接入授权、Space scope、数据库查询、游标、响应字节限制、超时、速率/配额或服务端资源治理，不能直接声明为正式 API 或 V20-08/V20-10 证据。除非出现新的设计批准和任务包，它保持隔离、不提交、不启用。

## 5. 当前最近动作

1. 已核对 Main candidate `31300835608`：`status=completed`、`conclusion=success`，运行 `head_sha` 等于 `2339002…`。
2. 候选 job 的 `pnpm ci:fast`、Compose 校验、候选镜像构建/证明、精确候选 smoke、Trivy/CodeQL/SBOM 和清理步骤均为成功。
3. 进行候选环境的人工作用回归（不发送真实邀请、不启用敏感生产能力），并将真实观察追加到状态文档/协调 Run。
4. GLM 切换暂不执行；只有用户明确同意后，才启用新的 GLM 任务包并重新规划下一项任务。
