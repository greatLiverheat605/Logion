# 子计划：AI 与 Integrations 治理工作台 GLM 一致性整改

## 状态

- **状态**：技术实现与自动化自检完成，等待真实 Session / GLM 统一验收
- **父计划**：`2026-08-26_logion-glm-design-conformance-remediation.md`
- **父步骤**：步骤 11
- **MCP 任务**：`0bec9a1f-a9af-46ac-b5eb-ade54f34461c`

## 目标

将 `/app/ai` 从 Provider/模型/路由/运行/草稿纵向堆叠改为 GLM 的双视图治理工作台，将 `/app/integrations` 从多卡片能力网格改为能力目录 + 详情主区 + Inspector；保留真实 API、Workspace/权限、Provider 密钥边界、发送来源预检、预算、运行取消/重试、草稿批准/拒绝、日历 Token、导入预览/提交、导出确认、capability-disabled 与 request ID。

## 实施范围

1. 为 AI 增加 route-specific Workbench 视图：草稿审查默认视图、模型设置视图；草稿列表/运行队列为 master，主区展示路由结果或草稿审查，Inspector 持续回显 Workspace、Provider、预算和数据外发边界。
2. 为 Integrations 增加 route-specific Workbench 视图：能力目录 master，主区按能力显示 Calendar/Import/Export，Inspector 展示当前 Workspace、权限、Private Space、unsupported capability 解释。
3. 使用现有 `WorkbenchFrame`、`WorkbenchTabs`、`WorkbenchSheet` 和 `AppIcon`，不新增 UI 库、不复制 GLM fixture/hash router/mock store。
4. 增加 AI/Integrations route-specific 测试，覆盖唯一 primary、关键区域、capability-disabled、密钥不回显、请求编号、Sheet/表单动作和移动无溢出。

## 关键约束

- 每个视觉视图最多一个 primary；低频创建/编辑进入 Sheet 或折叠区。
- Provider credential 永不回显；连接测试必须显式触发并显示影响。
- 第三方连接器保持入口可见但显示 capability-disabled 与替代路径。
- 危险撤销/导出/清除密钥保持影响范围、权限、确认与恢复路径。
- 页面 CSS 使用本地模块；不再向 `globals.css` 增加领域主体布局。

## 验证

- `pnpm --filter @logion/web typecheck`
- `pnpm --filter @logion/web lint`
- `pnpm --filter @logion/web test`
- `pnpm --filter @logion/web build`
- AI 与 Integrations 定向 Vitest；浏览器验收在真实登录 Session 和最新无挂载镜像上完成。
- 记录 `reports/ui-refactor/ai-conformance.md`、`reports/ui-refactor/integrations-conformance.md`，登记 GLM Target 路径、布局差异和真实证据缺口。

## 执行记录

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 2026-08-28 | D3 AI 与 Integrations Workbench 实现 | AI 改为运行/草稿审查与 Provider/模型设置双视图；Integrations 改为能力目录 + 详情主区 + Inspector；旧 ProductPanel 主体和迁移注释移除，导入/导出重复提交入口收敛到操作栏唯一 primary。 |
| 2026-08-28 | D3 route-specific 合同与回归 | 新增 AI Workbench Vitest，覆盖结构、唯一 primary、Sheet、credential 不入 DOM、草稿批准 submitter；Integrations 测试覆盖 capability 切换、Calendar token、Private Space 导入、导出认证、取消与 request ID。 |
| 2026-08-28 | D3 发布门 | `pnpm --filter @logion/web lint` 通过；全量 Vitest `63 files / 238 tests` 通过；`pnpm --filter @logion/web build` 通过并生成 35 页；MCP `verify_task` 评分 90/100 完成。 |
| 2026-08-28 | 证据边界 | 真实登录 Session、320/390/1024/1440 走查、Axe、键盘/焦点、reduced-motion、overflow、runtime console 和 GLM/PO 统一签字待 Gate 2，不用静态结果冒充。 |
