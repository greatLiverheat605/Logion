# TencentDB Agent Memory 接入与交接边界

状态：I1 已批准；记忆服务仍待实际部署端点验收，不代表已接入 Codex
日期：2026-08-17

## 1. 结论

TencentDB Agent Memory 可以作为 Logion 施工交接的辅助记忆层，但不能替代 Logion 仓库中的长期工作流、产品规格、Git 状态和协调账本。

它适合保存：

- 已批准的产品决策、约束和未决问题；
- 施工任务的摘要、依赖、验收命令和交接结果；
- 跨窗口恢复一个工作场景所需的 L1/L2/L3 记忆；
- 在明确授权、脱敏后保存的对话片段。

它不能被假定为：

- Codex 桌面端新窗口的自动上下文注入；
- Git、`.agents/coordination/` 或 `V020_STATUS.md` 的权威副本；
- 自动捕获所有 Codex 桌面对话的透明录制器；
- 生产凭据、用户数据、API Key、SSH 私钥或部署配置的保险箱。

## 2. 当前实测边界

当前运行环境没有提供 `MEMORY_ENDPOINT`，因此没有执行服务健康检查，也不能声称记忆服务已部署或已接入 Codex。实际部署必须在目标主机重新完成健康、隔离、持久化和恢复验收；本机目录、端口和检出信息不进入仓库。

仓库文档明确支持 Claude Code、CodeBuddy、Hermes、OpenClaw 和 SDK；通用接入需要 OpenAI/Anthropic 兼容端点，并携带 `x-team-id`、`x-agent-id`、`x-task-id`、`x-conversation-id`。未携带这些 Header 的客户端可能进入 session bypass，记忆注入和对话回流不会生效。仓库当前没有 Codex 桌面端专用适配器。

## 3. Logion 的权威顺序

跨窗口恢复必须按以下顺序执行：

1. 用户当前指令和已批准的设计；
2. Git 工作树、提交、测试和真实运行结果；
3. 仓库 `AGENTS.md`；
4. `docs/development/AGENT_DELIVERY_WORKFLOW.md`、`V020_EXECUTION_PLAN.md`、`V020_STATUS.md`；
5. `.agents/coordination/current-run.json` 指向的 Run、handoff 和 observation；
6. TencentDB Agent Memory 的已脱敏摘要。

记忆服务与本地账本冲突时，以前五项为准，并追加冲突记录，不覆盖历史事件。

## 4. 建议的隔离命名

仅在记忆服务中创建独立的 Logion 协作空间，不复用其他项目的 team 或 agent：

| 字段         | 建议值                      | 说明                             |
| ------------ | --------------------------- | -------------------------------- |
| team         | `logion-product`            | 仅存 Logion 产品与施工交接       |
| agent        | `codex-coordinator`         | 代表协调会话，不代表某个模型品牌 |
| task         | `workbench-v1-construction` | 本轮 Workbench v1 施工上下文     |
| conversation | 每个新窗口生成唯一 ID       | 禁止多个无关窗口复用同一 ID      |
| user         | 独立业务用户                | 不使用 admin key 运行日常会话    |

以上值是建议标识，不是已在服务端创建的事实。创建后必须以面板/API 返回值为准，并写入本地脱敏交接记录。

## 5. 接入验收门槛

在声称“会话已保存”前，必须在实际部署主机执行并保存证据：

1. `memory-core /health`、Panel、Knowledge 和 Proxy 的健康检查；
2. 创建或确认独立业务用户、team、agent、task，确认 ACL 不含其他项目；
3. 使用无敏感内容的测试会话写入一条 L0 记录；
4. 通过 API/Panel 读取同一 `conversation_id`，确认内容和隔离维度正确；
5. 重启服务后再次读取，确认持久化；
6. 等待并确认 L1/L2 提炼状态，记录是否因 LLM、队列或配置失败；
7. 使用无效 key、错误 team/agent/task 做负向测试，确认拒绝且不泄露其他空间；
8. 确认备份、恢复、保留期、磁盘权限和加密策略；
9. 用真实新窗口执行一次“读取本地交接文档 → 查询记忆 → 对照 Git”的恢复演练；
10. 记录端点、版本、时间、请求 ID 和结果，但不把 key、密码、内网地址或终端原文写入 Git。

任何一项未完成，都只能标记为“部署待验收”，不能标记为“已打通”。

### 部署方最小回传格式

请已部署方在实际主机执行并只回传脱敏结果（不要回传 key、密码、Cookie、内网地址或完整日志）：

```text
MEMORY_ENDPOINT=<运行时提供，不写入 Git>
GET  <MEMORY_ENDPOINT>/health                         -> HTTP 状态 + services 状态
POST <MEMORY_ENDPOINT>/capture                       -> 脱敏 marker + 四个隔离 Header
POST <MEMORY_ENDPOINT>/search/conversations          -> 命中同一 conversation_id
重启 Gateway 后再次查询                              -> marker 仍存在
错误 key / 错误 team-agent-task                       -> 4xx 且不泄露其他空间
```

回传必须附带服务版本、UTC 时间和请求 ID；没有这些结果，只能记录“部署待验收”。

## 6. 安全边界

- 默认不把完整 Codex 对话转发到 Proxy；只有确认脱敏和隔离后，才允许保存摘要或测试 L0。
- 禁止写入 API Key、密码、恢复密钥、Cookie、SSH 私钥、生产 `.env`、真实用户内容和公网凭据。
- 记忆服务不可作为 SessionBoundary、Workspace Role、Space ACL 或生产 feature flag 的替代品。
- 施工任务仍以本地 Git 和协调账本为准，记忆服务故障时项目必须可以继续恢复。
- 共享写入、删除、附件、Local Worker、Provider、sync-v1、AI Acceptance 等生产能力继续保持关闭。

## 7. 新窗口恢复操作

新窗口不能假设会自动读取 TencentDB Agent Memory。必须先打开本工作树，按 `AGENTS.md` 的顺序读取本地交接包，再使用部署端提供的受控查询方式读取本轮摘要。恢复后先输出：当前分支、HEAD、未提交文件、产品批准状态、未决问题和下一项任务；未经用户批准不得施工、提交、推送或部署。

### 新窗口启动提示词（可直接粘贴）

```text
你接手 Logion Workbench v1 主线施工协调。先不要改代码、提交、推送或部署。

打开用户在当前运行环境中明确指定的 Workbench v1 工作目录；不要把本机绝对路径写入仓库。
分支固定为：codex/product-workbench-v1-spec
权威施工包：docs/coordination/mainline-handoff/08_WORKBENCH_V1_CONSTRUCTION_TASK_PACKET.md
产品基线：docs/product/WORKBENCH_V1_PRODUCT_SPEC.md
原型规格：docs/design/workbench-v1/PROTOTYPE_SPEC.md

先按 AGENTS.md 的顺序读取 AGENT_DELIVERY_WORKFLOW.md、V020_EXECUTION_PLAN.md、V020_STATUS.md、
current-run.json（若存在）、施工包和 TencentDB Agent Memory 交接文档，然后执行：
git status --short --branch
git log -1 --oneline

TencentDB Agent Memory 只作为脱敏辅助记忆层，不能替代 Git、AGENTS.md、协调账本或真实测试。
不要猜测记忆服务地址；只有部署方通过运行时环境或安全凭据提供 MEMORY_ENDPOINT 时，才对
${MEMORY_ENDPOINT}/health 做只读健康检查。不要把 API key、密码、Cookie、SSH 私钥、生产 .env、
真实用户内容或终端原文写入仓库或记忆服务。缺少端点时明确报告“部署待验收”，项目仍按本地文档继续。

恢复后先报告：分支、HEAD、工作树、用户批准状态、记忆服务验收状态、未决问题和下一项任务。
I1 覆盖矩阵已经独立对抗复审并获产品 Owner 批准。恢复后先核对该批准和文档基线提交；在用户
另行批准具体正式施工批次前，不得修改 apps/web/src/**，也不得自行进入 I2。
```

这段提示词只恢复工作纪律和断点，不会自动证明记忆服务已经接通；端点验收仍需在实际部署主机执行。

## 8. 端点未提供时的处理

当前运行环境未提供 Gateway 端点，因此没有形成端到端记忆验收证据。一次辅助源码测试曾在依赖获取阶段超时，测试主体未执行；该结果既不是通过证据，也不能代替实际端点健康检查。其他主机的部署需要提供一次性、只读且脱敏的健康与隔离证据；不要把公网地址、内部地址、主机目录或密钥写入本仓库。端点未验收不阻塞文档基线，但阻塞“会话已保存/已打通”的结论。

## 9. 断点

- 本地权威施工包：`docs/coordination/mainline-handoff/08_WORKBENCH_V1_CONSTRUCTION_TASK_PACKET.md`
- 产品基线：`docs/product/WORKBENCH_V1_PRODUCT_SPEC.md`
- 原型规格：`docs/design/workbench-v1/PROTOTYPE_SPEC.md`
- 原型文件：`docs/design/workbench-v1/logion-workbench-v1-prototype.html`
- 当前分支：`codex/product-workbench-v1-spec`
- 当前状态：原型和 I1 已完成复审，I1 已获产品 Owner 批准；正式前端施工尚未获授权，记忆服务部署待验收
