# Architecture Decision Records

ADR 记录改变长期架构、数据寿命、安全、同步、权限或部署语义的决定。

状态使用 `Proposed`、`Accepted`、`Superseded` 或 `Rejected`。已接受 ADR 不改写结论；后续决定通过新 ADR 替代并相互链接。

命名格式：`NNNN-kebab-case-title.md`。

当前补充决策：

- [ADR-0027：Windows 异机加密备份](0027-off-host-windows-backup.md)
- [ADR-0028：三端薄壳移动应用（提案）](0028-thin-mobile-shells.md)
- [ADR-0029：自适应知识空间与人工验收边界（提案）](0029-adaptive-knowledge-space.md)
- [ADR-0030：Workbench v1 领域投影、持久化与权限边界（提案）](0030-workbench-v1.md)
- [ADR-0031：核心实体软删除与 tombstone 同步（Accepted；活跃引用阻止删除）](0031-entity-deletion.md)
- [ADR-0032：目标阶段生命周期（Accepted；原地修订当前计划版本，默认关闭）](0032-goal-phase-lifecycle.md)
- [ADR-0033：知识来源链接（Accepted；只存 ID、偏移与摘要哈希，默认关闭）](0033-knowledge-source-links.md)
- [ADR-0034：加密表单草稿（Accepted；四个长文本表单，存为 Vault 记录，不同步）](0034-encrypted-form-drafts.md)
- [ADR-0035：离线兜底页（Service Worker 部分已被 ADR-0037 替代）](0035-offline-fallback-page.md)
- [ADR-0036：修正知识点、先修关系与回忆题（Accepted；停用保留作答历史，无开关）](0036-memory-corrections.md)
- [ADR-0037：停用 Service Worker（Accepted；自注销并清除 Logion 缓存，不动本机资料）](0037-service-worker-retirement.md)
- [ADR-0038：在线优先客户端（Accepted；v0.3 不在浏览器保存业务数据，取消本机口令与离线编辑）](0038-online-first-client.md)
- [ADR-0039：统一文献模型（Accepted；在 resources 上演进，CSL-JSON 与 Zotero 映射，论文记录迁入）](0039-unified-source-model.md)
- [ADR-0040：Zotero 与 WebDAV 接入（Accepted；只读同步，原文存坚果云，服务器只做加密缓存）](0040-zotero-and-webdav-integration.md)
- [ADR-0041：AI 隐私分级与任务路由（Accepted；想法/假设永不发送，经济档与高质量档）](0041-ai-privacy-classes-and-task-routing.md)
- [ADR-0042：知识网连线（Accepted；AI 只能建议，确认后变实线）](0042-knowledge-network-edges.md)
- [ADR-0043：AI 理解测验与掌握边界（Accepted；AI 批改只作证据，掌握由本人确认）](0043-ai-comprehension-quiz.md)
- [ADR-0044：周计划与周回顾（Accepted；未完成项逐项处理，含目标基本信息编辑）](0044-weekly-plan-and-review.md)
- [ADR-0045：外壳、视觉系统与三栏阅读器（Accepted；macOS 风格，指令面板，可自定义三栏）](0045-shell-visual-system-and-reader.md)
- [ADR-0046：冻结备考、自学、模板与协作审阅（Accepted；数据与接口保留，新前端不提供入口）](0046-module-freeze.md)
- [ADR-0047：Agent 收件箱、个人令牌与 MCP 桥（Accepted；v0.3.1，只读加写收件箱，不能删除）](0047-agent-inbox-and-mcp-bridge.md)
- [ADR-0048：PDF 准备与只读读取（Accepted；写入由受保护的 POST 完成，GET 只返回已授权缓存）](0048-pdf-preparation-and-read-only-retrieval.md)
- [ADR-0049：研究问题树（Accepted；拆分与合并保留原问题及引用，父子关系按本人和空间隔离）](0049-research-question-hierarchy.md)
- [ADR-0050：私人连线与 AI 建议边界（Accepted；类型外键、本人决策、拒绝永久去重）](0050-private-typed-link-suggestions.md)
