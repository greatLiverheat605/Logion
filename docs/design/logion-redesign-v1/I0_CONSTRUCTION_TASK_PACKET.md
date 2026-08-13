# Logion I0：正式前端重构施工任务包

> 状态：准备交给主线执行方；不绑定模型、厂商或客户端。
>
> 不自动授权 commit、push、merge、deploy 或生产开关。

## 1. 目标

将 D2 原型组合施工到现有 Logion Web：保留认证、权限、Space、API client、sync-v1 和现有领域对象合同，重构应用壳、可见信息架构、任务交互、视觉系统和知识图谱呈现。不得把 D2 合成数据或演示状态直接复制到正式产品。

## 2. 必读输入

按顺序读取：

1. `AGENTS.md`；
2. `docs/development/AGENT_DELIVERY_WORKFLOW.md`；
3. `docs/development/V020_EXECUTION_PLAN.md`；
4. `docs/development/V020_STATUS.md`；
5. `docs/product/SYSTEM_BLUEPRINT_REVIEW.md`；
6. `docs/product/PRODUCT_DIRECTION_MARKET_ANALYSIS.md`；
7. `docs/product/PRODUCT_REDESIGN_EXECUTION_PLAN.md`；
8. `docs/design/logion-redesign-v1/07_D2_DIRECTION_DECISION.md`；
9. `docs/design/logion-redesign-v1/08_D2_PROTOTYPE_SPEC.md`；
10. `docs/design/logion-redesign-v1/09_DESIGN_SYSTEM.md`；
11. `docs/design/logion-redesign-v1/10_ROUTE_MIGRATION_MAP.md`。

若输入文档与代码、合同或用户当前指令冲突，以用户当前指令、Git、合同和真实观察为准，并在回报中列出差异。

## 3. 基线与写入边界

- 不可变基线：`e2b85987d816baf53a089007e674cd440e9ce64f`；
- 建议施工分支：`codex/logion-redesign-i0`，从上述完整 SHA 创建；
- 唯一正式实现写入：`apps/web/src/**`、必要的 `apps/web/tests/**`；
- 只有在依赖评估、版本、许可证、peer、包体和审计记录齐全后，才可修改 `apps/web/package.json` 和 `pnpm-lock.yaml`；
- 设计文档和协调账本由协调方维护，施工方不得编辑 `.agents/coordination/**`、`V020_STATUS.md` 或历史证据；
- 禁止修改 `apps/api/**`、`apps/worker/**`、`packages/contracts/**`、`packages/offline/**`、数据库迁移、部署/生产配置和根脚本；
- 禁止触碰 `.tmp-v020-rc2/`、`.tmp-v020-rc4/`；
- 禁止真实邮件、邀请、Provider、生产 API、秘密、用户目录、Docker 或敏感生产开关。

## 4. 不可变行为合同

- 保留 21 条旧 URL、`/app` 承接页和历史 `/app/knowledge-prototype`；只改变可见 IA，不改变后端权限；
- 保留 `SessionBoundary -> PersonaProvider -> VaultSessionProvider`；Persona 只影响入口，不改变授权；
- Knowledge Base 直接映射一个 `Space`；Collection/Tag/Saved View 不产生新权限实体；
- 正式对象唯一事实源；工作台、图谱、Review 和 Research 只能引用和投影；
- Graph 只显示服务端授权的 1/2 跳 bounded view，150 节点/400 边硬上限，移动端必须有列表/树替代；
- Source/Excerpt/Citation/Claim/Evidence 必须可回到来源版本和定位；AI 只能 Draft/Suggested；
- Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 扩展和 AI Acceptance 继续 default-off；
- 命令统一实现 Idle → Validating → Pending → Success/Conflict/Error，409 不静默覆盖，危险操作必须确认和最近认证。

## 5. 施工批次

### I0-A：Tokens 与 primitives

先建立双主题 tokens、App Shell、Button/Input/Toggle/Segment/Tabs、Inline Status、Toast、Request ID、Conflict Resolver、Confirm Dialog 和焦点管理。完成前不迁移页面。

### I0-B：Shell 与路由适配

建立 Today、Workbench、Knowledge Base、Collaboration、System Center 五个可见区域，保留 21 个 URL 的适配和深链接。不要把两个完整页面嵌套在一个页面中；布局恢复只保存 ID、路由、视图、尺寸和固定状态。

### I0-C：高频路径

按 Today → Knowledge/Review/Graph → Records/Research 的顺序迁移；先做真实只读数据适配，再处理受控写入。所有 loading/empty/offline/locked/permission/409/error 状态就地可见。

### I0-D：低频路径

迁移 Collaboration/Workspace/Space/Invite 与 System Center 设置列表；Profile/Settings/Security/Sync/Data/Integrations/AI/Help 通过 System Center 模板承接，保留 URL。

### I0-E：质量与交接

补齐 21 路由回归、键盘/读屏/axe、reduced-motion、主题持久化 XSS、1440/1024/390/320 无溢出、Graph 上限、409/离线和错误恢复测试；输出结构化 handoff，等待协调方审查。

## 6. 验收命令与观察门

施工方至少实际运行：

```text
pnpm --filter @logion/web lint
pnpm --filter @logion/web typecheck
pnpm --filter @logion/web test
pnpm exec prettier --check apps/web/src apps/web/tests
pnpm exec playwright test
pnpm ci:fast
```

浏览器门必须真实覆盖：21 路由认证访问、Today 下一步、知识库 Sources/Reader/Graph/Review、移动节点列表、桌面图谱键盘、研究证据回源、邀请 409、离线/能力关闭/错误恢复、1440/1024/390/320 横向溢出、Light/Dark 持久化、axe、reduced-motion、主题值 XSS。

未运行的命令必须写明原因；计划、旧截图或静态 mock 不能记为通过。

## 7. 停止条件

出现 API/合同/迁移/权限/sync-v1/生产配置需求、真实账户或邮件需求、依赖安全/许可证无法解释、路由无法保留、认证边界不清或测试环境不可用时，立即停止该批次并回报，不要越权修复。

## 8. 交接格式

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

施工方不得自行 commit/push/merge；需要 Git 动作时先报告完整 SHA、diff、检查结果和建议动作，等待用户明确授权。
