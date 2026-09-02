# 子计划：Security、Data 与 Audit 治理工作台 GLM 一致性整改

## 状态

- **状态**：技术实现与自动化自检完成，等待真实 Session / 四视口 / PO 走查
- **父计划**：`2026-08-26_logion-glm-design-conformance-remediation.md`
- **父步骤**：步骤 12
- **MCP 任务**：`de4060a5-8764-4d24-bed1-6bde64445eb1`

## 目标

按 GLM 的 settings list、Data View 和危险区隔离要求，重构 `/app/security`、`/app/data`、`/app/audit` 主体；保留 Passkey、TOTP、恢复码、设备撤销、导入导出、账户删除、审计筛选分页和拒绝事件语义。

## 路由验收线

1. Security：Security Checklist Master、认证设置 Main、设备与恢复 Inspector；低频 Passkey / TOTP 操作进入 Sheet，危险撤销带影响范围与确认。
2. Data：Export / Import Master、Data View Main、Isolated Danger Inspector；导出、导入和账户删除分别隔离，导出必须近期认证，导入只写自己的 Private Space。
3. Audit：Filter Command Bar、Audit Timeline Main、Inline Event Detail Inspector；只读首交互为筛选，拒绝/错误事件可解释并显示 request ID。

## 约束

- 使用现有 `WorkbenchFrame`、`WorkbenchTabs`、`WorkbenchSheet`、`AppIcon`；不新增 UI 库。
- 每个视图最多一个 `data-workbench-primary="true"`，不保留旧 `ProductPanel` / `planning-form` 主体。
- 真实 controller/API 驱动 loading、empty、error、permission、recent-auth、409、offline、capability-disabled、stale 等状态。
- 危险操作明确影响范围、权限、确认短语 / 当前认证、不可逆后果和恢复路径。

## 验证

- `pnpm --filter @logion/web typecheck`
- `pnpm --filter @logion/web lint`
- `pnpm --filter @logion/web test`
- `pnpm --filter @logion/web build`
- Security / Data / Audit route-specific Vitest 与真实浏览器四视口走查。
- 记录 `reports/ui-refactor/security-conformance.md`、`data-conformance.md`、`audit-conformance.md`；真实 Session 缺失时只登记证据缺口。

## 执行记录

| 时间             | 路由     | 状态     | 结果                                                                                                                                                                                                                                                                                                                         |
| ---------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-28 01:51 | Security | 技术完成 | `security-center.tsx` 已迁移到 Checklist Master / Settings Main / Security Inspector；补齐 `security-workbench.module.css` 与 `security-workbench.test.tsx`。MCP `a2d3fa42-d957-4d9e-b656-3030481d19f2` 已以 88/100 验证完成。                                                                                               |
| 2026-08-28 02:13 | Data     | 技术完成 | `Data Workbench` 已迁移到 Export / Import Master、Data View Main、Danger Inspector；导入显式二步确认、Private Space 边界、删除恢复和 offline / permission / recent-auth / 409 / error / capability-disabled 均保留。Web 66 files / 247 tests、typecheck、lint 通过；MCP `984ed501-8002-428d-9f6f-f5fdd66b3b57` 88/100 完成。 |
| 2026-08-28 02:15 | Audit    | 技术完成 | `Audit Workbench` 已迁移到 Filter Command Bar、Audit Timeline、Inline Event Detail；保留 `/api/v1/audit/me` 的 page_size / cursor、结果与目标筛选、事件 ID 和 request ID 错误语义。Web 66 files / 247 tests、typecheck、lint、build 通过；MCP `ec251af5-0316-479e-afec-88efdae7200d` 88/100 完成。                           |

## Security 证据边界

- 已验证：`pnpm --filter @logion/web typecheck`、`pnpm --filter @logion/web lint`、Security 定向 Vitest；当前总计 `64 files / 241 tests` 通过。
- 已验证：无旧 `ProductPanel` / `planning-form` 主体字符串，页面结构包含 `WorkbenchFrame`、Master、Main、Inspector 与 Sheet。
- 待补：真实 Session/API/权限/Vault 任务、320/390/1024/1440 截图、Axe、键盘/读屏、reduced-motion、overflow 与运行镜像摘要；这些不以静态测试替代。

## Data 证据边界

- 已验证：Data route-specific tests、Web 全量 `66 files / 247 tests`、typecheck、lint、production build。
- 已验证：真实 `integrationCapabilityService` 导入/导出 API、Private Space 目标、账户删除 API、错误状态和唯一 primary 合同。
- 待补：真实 8080 Session/API 任务、320/390/1024/1440 截图、Axe、键盘/读屏、reduced-motion、overflow、runtime console 与无挂载镜像摘要；这些不以静态测试替代。

## Audit 证据边界

- 已验证：Audit route-specific tests、事件筛选组合、cursor 分页、事件选择、stale request 保护、Web 全量 `66 files / 247 tests`、typecheck、lint、production build。
- 已验证：只读 `/api/v1/audit/me` 读取语义、拒绝结果解释和真实 request ID 错误路径；未新增写操作或虚构字段。
- 待补：真实 Session/API 事件、320/390/1024/1440 截图、Axe、键盘/读屏、reduced-motion、overflow、runtime console 与无挂载镜像摘要；这些不以静态测试替代。
