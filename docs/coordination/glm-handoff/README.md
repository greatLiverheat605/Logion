# Logion v0.2.0：GLM 主线交接包

更新时间：2026-08-09（Asia/Shanghai）

本目录是交给 GLM/ZCode 的唯一主线交接入口。它把当前基线、已完成工作、真实验收证据、未决门禁、版本规划和执行规则集中起来；聊天记录不是项目记忆，恢复工作时先读本目录，再按仓库 `AGENTS.md` 指定的顺序读取源文档。

## 阅读顺序

1. [00_CURRENT_STATE.md](./00_CURRENT_STATE.md)：当前事实、基线和阻塞点。
2. [01_WORK_RECORD.md](./01_WORK_RECORD.md)：从 M0 到当前的工作记录与决策演变。
3. [02_EXECUTION_PLAN.md](./02_EXECUTION_PLAN.md)：下一阶段门禁、任务顺序和停止条件。
4. [03_GLM_TASK_PACKET.md](./03_GLM_TASK_PACKET.md)：可直接粘贴给 GLM 的启动提示词。
5. [04_ACCEPTANCE_CHECKLIST.md](./04_ACCEPTANCE_CHECKLIST.md)：每个阶段的验收清单和证据要求。
6. [05_MODEL_ROUTING.md](./05_MODEL_ROUTING.md)：模型职责调整；当前只启用 GLM 主线。
7. [06_DECISION_LOG.md](./06_DECISION_LOG.md)：不可逆或跨会话决策索引。

## 权威源

- [AGENTS.md](../../../AGENTS.md)
- [AGENT_DELIVERY_WORKFLOW.md](../../development/AGENT_DELIVERY_WORKFLOW.md)
- [V020_EXECUTION_PLAN.md](../../development/V020_EXECUTION_PLAN.md)
- [V020_STATUS.md](../../development/V020_STATUS.md)
- [.agents/coordination/current-run.json](../../../.agents/coordination/current-run.json)
- [NEXT_VERSION_ROADMAP.md](../../product/NEXT_VERSION_ROADMAP.md)

本交接包是面向 GLM 的可读索引，不替代上述权威源。若交接包与实际 Git、CI 或用户当前指令冲突，以用户当前指令、实际检查结果、Git 和 `AGENTS.md` 为准，并在本目录追加修订记录。
