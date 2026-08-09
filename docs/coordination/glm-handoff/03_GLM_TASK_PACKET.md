# 可直接交给 GLM 的启动提示词

将下面整段粘贴给 GLM/ZCode。它是当前主线的启动包，不包含任何密钥或私有连接信息。

```text
你现在接手 Logion 项目的唯一主线实施工作，角色是 GLM/ZCode 主线执行模型。

仓库与基线：
- 正式集成工作树：v020-integration
- 协调分支：codex/v020-integration
- 已合并产品 main：2339002cd084950c3b859db561ade66fcfa528f4
- PR #202：fix: improve UX feedback for workspace actions，已 Rebase and merge
- 合并后 Main candidate：31300835608；开始时必须重新查询实际状态和 head_sha

接手前必须按顺序阅读：
1. AGENTS.md
2. docs/development/AGENT_DELIVERY_WORKFLOW.md
3. docs/development/V020_EXECUTION_PLAN.md
4. docs/development/V020_STATUS.md
5. .agents/coordination/current-run.json 及其指向的 Run
6. docs/coordination/glm-handoff/README.md 及 00～06 全部文件

第一轮任务：只做基线和 Main candidate 核对，不修改业务代码：
- 确认当前分支、HEAD、远端 main SHA 和工作树 clean 状态；
- 查询 Main candidate 31300835608，核对 status、conclusion、head_sha；
- 检查 PR #202 的合并状态；
- 真实观察到的结果写入交接目录和 V020_STATUS.md，未执行项写 not_run 及原因。

通过第一轮后，按 02_EXECUTION_PLAN.md 进入 v0.2.0 发布候选收口：
- 验证中文就地反馈、loading/disabled、防重复提交、搜索最短长度、本地口令错误、画像名称校验、邀请 409 映射和可访问性关联；
- 使用受控夹具/验收账号，不发送真实邀请，不收集真实用户内容；
- 只做最小、可回滚修复；每次修复都运行实际测试并记录命令和结果；
- 不把计划、静态测试或模型自报当成通过。

不可变安全边界：
- Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 生产开关保持关闭；
- 不启动本机 Docker，不绕过 SessionBoundary，不修改 Provider/hooks/CCSwitch 配置；
- 不在仓库写入 API key、token、密码、SSH 材料、私有主机数据、真实邮箱、终端转录或用户目录；
- 不直接把 GLM 纯内存 graph kernel 候选接入正式 API；它缺少授权、scope、游标、资源治理；
- 不自行 merge、push、release 或切换生产流量。

完成后必须返回：
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

如果 Actions、环境、凭据、基线、模型证据或用户授权不满足，明确报告 blocker 并停止，不伪造通过。
``` 
