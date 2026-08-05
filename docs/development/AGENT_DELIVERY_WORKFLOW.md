# Logion 多 Agent 交付工作流

> 状态：长期有效的项目协作 SOP。
> 所有者：Windows Codex 协调员；产品方向和发布由用户最终批准。
> 当前版本状态：[`V020_STATUS.md`](./V020_STATUS.md)。

## 1. 权威顺序

项目不能依赖聊天记录作为长期记忆。发生冲突时，按以下顺序判断：

1. 用户当前指令和已经明确批准的规格；
2. Git 中的代码、合同和适用的 `AGENTS.md`；
3. Windows Codex 实际观察到的 Git、测试、构建和运行结果；
4. Orca 当前 Run、Task、Dispatch 和终端生命周期；
5. `.agents/coordination/` 本地账本与本文件的进度快照；
6. Worker 的完成报告。

Worker 声称 `complete` 不等于验收通过；原型技术检查通过也不等于产品方向获批。

## 2. 固定角色

| 角色                | 默认职责                                                                 | 默认禁止事项                                                                 |
| ------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Windows Codex       | 需求澄清、架构、任务拆分、敏感后端、独立验收、集成、最终测试、提交与推送 | 不覆盖不明修改，不绕过失败门禁                                               |
| Kimi / Claude Code  | 仅当前第一版整体审批原型及其原型代码                                     | 不承接后续前端迭代；不定义认证、权限、迁移、OpenAPI、Provider；不 merge/push |
| GLM / ZCode         | 独立、非敏感、边界清晰的模块实现与测试；由用户手工操作桌面客户端         | 不处理秘密、认证、迁移批准、合同所有权；不 merge/push                        |
| DeepSeek / OpenCode | 候选 diff 的只读安全、合同和回归审查                                     | 不编辑、不执行破坏性命令、不 commit/merge/push                               |

不用为了“让所有模型都有事做”而派发任务。只有可独立验收且协作收益高于协调成本时才分派。

当前模型所有权决策：Kimi 完成并交接本次第一版整体原型后即退出前端 owner 角色。后续正式前端
实现、修改和版本迭代的模型由用户另行指定；在收到指定前，状态保持 `owner pending`，Windows
Codex 不得默认续派 Kimi。ZCode/GLM 保持手工桌面交接：用户负责粘贴任务包和启动执行，
Windows Codex 负责生成提示词、限定范围并独立复核；除非用户另行明确授权，不由 Codex
操控 ZCode 图形界面。

## 3. 标准阶段与审批门

```text
用户目标
  -> Codex 核对基线、边界和依赖
  -> 架构/威胁模型草案
  -> 整体 UX 原型
  -> 用户审批设计
  -> 冻结信息架构、视觉语言和状态语义
  -> 按 DAG 分派独立模块
  -> Worker 结构化交接
  -> Codex 独立复核与退回小修循环
  -> 集成门禁
  -> DeepSeek 只读终审
  -> 回滚演练
  -> 用户授权 commit/push/release
```

不可跳过的规则：

- 未完成整体原型和用户审批，不开始正式前端施工。
- ADR、权限/API、迁移、保留策略等必要设计门未通过，不开始 V20-08 核心实现。
- 模块先行产物只能作为候选，不能提前宣称下游任务完成。
- 用户否决设计后，保留旧验收记录作为历史证据，并新建修订决策/任务；不得篡改旧事件。

## 4. 每个任务的启动契约

任务包必须明确：目标、不可变 base、worktree/branch、唯一 writable paths、禁止路径、行为、
非目标、接口不变量、验收命令、交接格式和停止条件。

启动前必须：

1. 读取适用 `AGENTS.md`、本文件、当前版本计划和状态；
2. 检查 `git status --short --branch`、HEAD、远端可达性和工作树冲突；
3. 跨机器任务验证同一完整 SHA；
4. 在 assignment 之前记录准确模型证据；
5. 每个 branch/worktree 只允许一个 writer，并禁止并发写路径重叠；
6. 任何秘密、Provider endpoint、私有主机数据、用户目录或终端记录不得进入任务包或仓库。

## 5. Worker 交接格式

Worker 必须返回：

```text
Outcome: complete | partial | blocked
Base commit:
Working branch:
Changed files:
Commands actually run:
Observed results:
Unrun checks and reason:
Known risks or assumptions:
Working tree status:
Suggested next action for the coordinator:
```

计划运行、写了测试、或环境不可用都不能记为 passed。未运行检查必须单列原因。

## 6. Codex 验收循环

1. 检查完整 diff、未跟踪文件、基线、branch 和允许路径。
2. 扫描秘密、生成性本地状态和越界文件。
3. 独立重跑最窄的目标检查，再逐步扩大到包级、仓库级和浏览器/设备门禁。
4. 复现 Worker 风险和审查发现；发现确定性缺陷时退回原 owner 小修。
5. 只有绑定实际观察证据后，任务才能 accepted。
6. 技术 accepted 与产品 approved 分开记录。

外部 Worker 默认不 commit、不 merge、不 push。Windows Codex 只有在用户明确授权相应 Git
动作后才创建最终提交、集成或推送。

## 7. 长期记忆与恢复

需要跨会话保存的事实写入两层：

- **Git 跟踪层**：`AGENTS.md`、本 SOP、版本执行计划和带日期的状态快照；保存长期规则、DAG、
  门禁和人类可读进度。
- **本地追加账本**：`.agents/coordination/current-run.json` 指向的 Run；保存决策、任务生命周期、
  handoff、Codex observations 和图索引。真实 Run 不进入 Git。

以下时点必须更新长期记忆：

- 用户批准、否决或替代设计；
- Task 创建、分派、阻塞、恢复、完成、拒绝或接受；
- 基线、所有权、允许路径或验收命令变化；
- 对话即将压缩、客户端关闭或跨机器交接；
- commit、push、merge、回滚或版本门状态变化。

恢复工作时先验证当前 Run：

```powershell
pnpm agent:state:validate -- .agents/coordination/runs/<run-id>
```

验证失败时停止派发并保留现场；Git 与实际检查结果始终高于账本摘要。

## 8. 版本收口

版本完成必须同时具备：

- 用户批准的设计和范围；
- 所有必要任务的可核验 handoff 与 Codex observation；
- 数据、权限、安全、同步、离线、性能、浏览器和回滚门禁；
- DeepSeek 最终只读 findings 及 Codex 处置；
- acceptance manifest、残余风险、未运行项和清理清单；
- 用户明确授权的 commit/push/release 动作。

缺少任何一项时，状态保持设计中、实现中或待验收，不得宣称版本完成。
