# Logion v0.2.0：主线交接包

更新时间：2026-08-10（Asia/Shanghai）

本目录是交给用户当前指定主线执行方的唯一主线交接入口。它把 RC6 受控 prerelease、真实验收证据、未决门禁、前端重设计审批门和后续版本计划集中起来；聊天记录不是项目记忆，恢复工作时先读本目录，再按仓库 `AGENTS.md` 指定的顺序读取源文档。

## 阅读顺序

1. [00_CURRENT_STATE.md](./00_CURRENT_STATE.md)：当前事实、基线和阻塞点。
2. [01_WORK_RECORD.md](./01_WORK_RECORD.md)：从 M0 到当前的工作记录与决策演变。
3. [02_EXECUTION_PLAN.md](./02_EXECUTION_PLAN.md)：下一阶段门禁、任务顺序和停止条件。
4. [03_MAINLINE_TASK_PACKET.md](./03_MAINLINE_TASK_PACKET.md)：可直接粘贴给当前主线执行方的启动提示词。
5. [04_ACCEPTANCE_CHECKLIST.md](./04_ACCEPTANCE_CHECKLIST.md)：每个阶段的验收清单和证据要求。
6. [05_MODEL_ROUTING.md](./05_MODEL_ROUTING.md)：执行方职责调整和模型切换规则。
7. [06_DECISION_LOG.md](./06_DECISION_LOG.md)：不可逆或跨会话决策索引。
8. [07_FRONTEND_REDESIGN_BRIEFS.md](./07_FRONTEND_REDESIGN_BRIEFS.md)：两个互相独立、仅设计不施工的前端重设计任务包。

## 权威源

- [AGENTS.md](../../../AGENTS.md)
- [AGENT_DELIVERY_WORKFLOW.md](../../development/AGENT_DELIVERY_WORKFLOW.md)
- [V020_EXECUTION_PLAN.md](../../development/V020_EXECUTION_PLAN.md)
- [V020_STATUS.md](../../development/V020_STATUS.md)
- [V020_V15_PRERELEASE_RC6_EVIDENCE.md](../../development/V020_V15_PRERELEASE_RC6_EVIDENCE.md)
- [.agents/coordination/current-run.json](../../../.agents/coordination/current-run.json)
- [NEXT_VERSION_ROADMAP.md](../../product/NEXT_VERSION_ROADMAP.md)

本交接包是面向主线执行方的可读索引，不替代上述权威源。若交接包与实际 Git、CI 或用户当前指令冲突，以用户当前指令、实际检查结果、Git 和 `AGENTS.md` 为准，并在本目录追加修订记录。

## 当前新增任务包

- [08_WORKBENCH_V1_CONSTRUCTION_TASK_PACKET.md](./08_WORKBENCH_V1_CONSTRUCTION_TASK_PACKET.md)：Workbench v1 正式施工顺序、验收门槛和停止条件。
- [09_WORKBENCH_V1_I2_CONSTRUCTION_TASK_PACKET.md](./09_WORKBENCH_V1_I2_CONSTRUCTION_TASK_PACKET.md)：I2 研究与考试领域施工范围、白名单和验收门。
- [TENCENTDB_AGENT_MEMORY_HANDOFF.md](../../development/TENCENTDB_AGENT_MEMORY_HANDOFF.md)：TencentDB Agent Memory 的接入边界、验收和新窗口恢复规则。

当前状态（2026-08-19）：Workbench v1 的 W1（M1-M4 与 S1）已完成并提交于 `22b9e339d1935e81685dda1c043384f914c58d02`；Web 68 文件/525 测试与真实认证浏览器 32/32 通过，独立整批复审第二轮 PASS。根级 `ci:fast` 仍受既有 Worker 第三方 mypy stub 缺失阻塞，未修改该无关文件。Product Owner 已批准进入 I2 任务包准备，I2 包已建立但正式代码施工尚未开始；当前分支尚未 push、merge 或 deploy。TencentDB Agent Memory 继续单独待验收。
