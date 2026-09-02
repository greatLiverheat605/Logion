# v0.1.1 执行计划：可信运行与体验收口

> 状态：已启动，首波任务已建立；尚未达到发布验收。
>
> 本计划只覆盖 v0.1.1。论文研读与证据工作台属于 v0.2.0，Connector/Automation v2 属于独立立项，均不在本轮派发范围内。

## 1. 不可变基线

| 项目               | 值                                         |
| ------------------ | ------------------------------------------ |
| 仓库               | `Logion`                                   |
| 基线提交           | `e11d78b3d1a96c40263fa4284695a19b55f22f7c` |
| 集成分支           | `codex/v011-coordination`                  |
| 基线远端分支       | `origin/codex/multi-agent-coordination`    |
| Orca Run           | `run_68d8b9d2895b`                         |
| 本地状态 Run       | `run-v011-closeout`                        |
| 唯一协调账本写入者 | Windows Codex                              |

所有写入任务必须从该提交开始；不得以 `origin/main` 的 `0.1.0-rc4` 代替本轮基线，也不得把手工 ZCode 交接描述为 Orca 自动监督。

## 2. v0.1.1 范围

### P0：Worker 可靠性

- 真实 liveness/readiness，区分进程存活、轮询成功、依赖可用和连续失败。
- 公平轮转调度，避免单一队列长期占用。
- 每个队列输出聚合的 queued/running/failed、最老任务年龄、租约超时和重试次数。
- 日志只保留任务类型、阶段、固定错误码、异常类型和临时关联 ID。
- 管理员健康信息只显示聚合状态，不显示正文、邮箱、Token 或 Provider 凭据。

### P0：认证 E2E 可信度

- 每个 Playwright worker 使用独立账号和 `storageState`。
- public-web、authenticated-real-stack、mobile-layout 分离。
- Release/Nightly 认证门禁禁止静默跳过。
- 远程环境没有显式凭据时禁止自动注册；本地隔离环境才允许受控 provisioning。
- 记录稳定性样本；未运行的 PostgreSQL、Redis、浏览器或真实设备检查必须写明原因，不能记为通过。

### P1：核心 UI 收口

- Today：今日状态、下一行动、快速捕获、待复习。
- Review：到期复习、主动回忆、错因、周期检查。
- Settings：个人偏好、安全、数据、Integrations 分组。
- 所有空、加载、错误状态提供真实起始动作或恢复建议。
- 保持键盘、焦点、读屏、axe 和 320/390px 断点行为。

### P1：首轮技术债

- `sync/push.py` 按实体族注册处理器，保持 sync-v1 契约、顺序、校验和幂等性。
- 后续再拆 `useVaultWorkspaceRefresh`、Today/Review/Self-study 控制器，以及 worker 测试结构；不得与首波 UI 路径重叠。

## 3. 任务分配与当前状态

| 任务                                                     | Owner                        | 允许写入                                            | 验收状态                                                     |
| -------------------------------------------------------- | ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Core UI information architecture closeout                | Kimi K3 / Claude Code        | `apps/web/src/**`、直接 UI 测试                     | Orca Dispatch 已建立；客户端曾停在启动确认，未产生可接纳改动 |
| Worker reliability and authenticated E2E stability audit | Windows Codex                | `apps/worker/**`、`tests/browser/**`、必要 workflow | 协调者执行中；Worker 定向测试以 workspace 方式 11/11 通过    |
| Read-only v0.1.1 baseline review                         | DeepSeek V4 Flash / OpenCode | 只读                                                | 初次启动遇到 OpenCode 插件错误，尚无有效 review receipt      |
| Sync entity-family handler split                         | ZCode / GLM-5.2              | `apps/api/src/logion_api/sync/push.py` 与直接测试   | 独立 Windows worktree 已建立，等待手工打开 ZCode             |

外部 worker 不得修改 `.agents/coordination/**`、合并、推送、迁移、认证、契约或密钥。DeepSeek 只读任务即使报告完成，也不能授权 Codex 代替它修改文件。

## 4. 验收门禁

1. 先做任务级门禁：路径审查、`git diff --check`、目标包测试、Ruff、mypy/typecheck、目标构建。
2. 认证或契约变化必须由 Codex 复核负向用例、secret scan 和真实浏览器/API 流程；未提供凭据时不得自动注册远程账号。
3. UI 行为变化且环境可用时运行 `pnpm test:browser`；不可用时写入 `unrunChecks` 和明确原因。
4. 合并前在集成工作树运行 `pnpm ci:fast`；若依赖服务不可用，保留失败现场，不得宣称发布就绪。
5. Codex 独立检查 Worker handoff，计算原始 receipt SHA-256，写入 coordinator observation，再将任务从 `completed` 推进到 `accepted`。

## 5. 下一波顺序

1. 先修复或重新启动 Kimi 与 DeepSeek 的客户端入口；只有看到真实 `worker_done`/`escalation` 才关闭对应 Dispatch。
2. Codex 完成 Worker 与认证 E2E 审计，补齐缺失的观测指标或测试；不扩大到 API 迁移和新功能。
3. ZCode 手工交付 sync handler split 后，Codex 检查 diff 和直接测试，必要时退回，不让其自行合并或推送。
4. 只有 UI、Worker、认证和 sync 首轮门禁均有证据，才派发下一轮 `useVaultWorkspaceRefresh` 与控制器拆分。
5. v0.1.1 全部门禁通过并稳定观察后，再进入 v0.2.0 的离线连续性和学习洞察设计；Connector/Automation 仍需独立 ADR 与威胁模型。

## 6. 当前不接受的结果

- “写了测试”但没有实际运行结果。
- 认证套件被 skip 却被汇报为绿色。
- 旧的 `origin/main`/`0.1.0-rc4` 被误报为 v0.1.1 基线。
- ZCode 手工 Git 交接被伪装成 Orca `worker_done`。
- DeepSeek/OpenCode 只读审查修改了文件。
- 任何包含密钥、Token、`.env`、Provider endpoint、终端句柄或用户主目录的任务包或账本。
