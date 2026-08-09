# 工作记录摘要

本文件记录对后续执行有影响的事实，不复制聊天全文、终端转录、凭据或私有主机信息。

## M0 与原型

- 用户批准 M0 架构方向：首版复用 `Resource`；citation 显式指向四类目标；`TopicDependency` 保持唯一先修关系；API 只加法、online-only、默认关闭且不改 sync-v1；共享知识写入继续关闭。
- Kimi 完成第一版动态知识空间原型和 UX 方向。用户批准按该原型施工，并一次性指定 Kimi K2.7-code 完成正式前端首版；该授权不延续到后续版本。
- Codex 审查原型施工，修复正式节点落在 `(0,0)` 的重叠问题，并补齐格式、真实 Review 数据适配、只读动态图谱、移动列表、桌面键盘交互和状态面板。

## 设计、后端与门禁

- V20-01/03/07 设计基线获批；V20-02 完成隔离 PostgreSQL 迁移往返、约束负测、孤儿停止、非空降级停止、备份恢复和合成规模估算。
- V20-04 完成加法 OpenAPI/TypeScript 合同、休眠 Permission、默认关闭路由、严格 Schema、HMAC 游标、ETag 和双桶限流原语；sync-v1 固定哈希未变。
- V20-08 完成 bounded knowledge-space core：ORM、授权、Private owner 隔离、Shared 写入默认关闭、行锁复核、ETag、HMAC cursor、有界图读取和超时错误。
- V20-09 完成 AI candidate/receipt 接受闭环：RFC 8785 幂等 hash、事务内重新授权和确定性锁定；Acceptance 仍 fail-closed。
- V20-10 完成真实栈图谱/搜索/渲染验收；Nightly #40 固定 SHA 全绿，覆盖 audit、Compose、迁移/空环境恢复、真实认证 Playwright、1440/390px、axe、移动节点列表、桌面图谱键盘导航和持久化主题值 XSS 防护。
- V20-11～V20-14 的默认关闭准入、集成门、DeepSeek 只读终审和隔离回滚演练均已记录并接受；生产开关仍关闭。

## 运行与交付事件

- GitHub 发生过 Actions 不可用/运行头 SHA 不一致的监控断点；规则是只记录真实状态，条件不满足时不重跑、不伪造通过、不进入下一门。
- 用户曾要求每小时监控 GitHub；该定时监控后来明确不再需要，不能重新创建。
- Mac 端 Kimi/Claude CLI 的 hooks 曾导致登录异常；用户删除 hooks 后恢复。后续不得擅自新增 hooks 或修改用户 Provider 配置。
- Kimi 中转曾出现 API 400；用户确认官方 Kimi 可用。模型路由问题与仓库实现问题分开记录，不把中转错误写成产品缺陷。

## UX 问题与 PR #202

- 用户真实人工检查发现：按钮缺少反馈、提示框不全、邀请接口返回 409、部分操作不可重复安全提交。
- GLM/Kimi 的前端后续施工先暂停，后由指定模型完成修复；Codex 验收并创建 PR #202。
- PR 检查 `fast`、`integration`、`browser` 全部成功后，用户批准合并。
- 2026-08-09 PR #202 以 Rebase and merge 合并到 `main`，合并提交为 `2339002cd084950c3b859db561ade66fcfa528f4`；Main candidate 随即自动启动。
- 2026-08-09 Main candidate `31300835608` 已完成并成功，`head_sha` 与合并提交一致；候选构建、provenance、精确候选 smoke、Trivy/CodeQL/SBOM 和清理步骤均真实完成。生产发布和流量切换未触发。
- 2026-08-09 受控公网检查 `/health` 返回 HTTP 200、`version=0.1.0`；确认公网仍为旧版本，v0.2.0 候选尚未部署。登录页可达但无已登录验收会话，认证后 UX 回归保持 `not_run`，未输入凭据或发送邀请。
- 用户要求先继续当前合并任务、暂不切换 GLM；GLM 交接包保持待命，待用户明确同意后再重新规划提示词。

## 不可混淆的历史候选

- 旧 Kimi A/B 原型技术通过但产品方向已否决，只保留历史证据。
- GLM 纯内存图内核技术通过但不是正式 API。
- DeepSeek 只读终审已完成，不再派发实现任务。
- 任何 worker 的 `complete` 或“写了测试”都不等于 Codex/用户验收通过；必须有实际运行证据。
