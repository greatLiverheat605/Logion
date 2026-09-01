# 子计划：Invitation、Share、Deletion、Offline 与 404 公共流程 GLM 一致性整改

## 状态

- **状态**：已完成 ✓（技术实现与真实浏览器审计；待统一 GLM/PO Gate 2）
- **父计划**：`2026-08-26_logion-glm-design-conformance-remediation.md`
- **父步骤**：步骤 14
- **目标**：按 GLM PublicShell / Wide Public View 重构五类公共入口，保留匿名、Session、权限、失效分享、删除恢复与离线语义。

## 路由范围

1. Invitation：接受邀请的 token、过期、撤销、已登录和无权限状态。
2. Share：只读分享加载、失效/撤销隐私、对象阅读与返回入口。
3. Deletion：影响范围、确认短语、近期认证、宽限期恢复。
4. Offline：网络不可用、重新连接、继续本地工作和登录恢复。
5. 404：可恢复导航、当前 Session 上下文和返回工作区。

## 约束

- 复用现有 `AuthFormShell`、`useSession`、`useVaultSession`、API client 和错误映射；不改 API、权限、Vault 或分享 token 语义。
- 公共流程使用专属布局，不把旧 `ProductPanel` 外包一层；危险删除操作必须保留影响范围、权限、确认和恢复路径。
- 失效分享不得泄露对象存在性；Offline 与 404 不伪造服务器状态。
- 真实 Session、四视口、Axe、键盘/读屏、reduced-motion 和无源码挂载镜像证据待报告阶段补齐。

## 执行记录

| 时间       | 路由                                          | 状态   | 结果                                                                                                                                                                                                                                |
| ---------- | --------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-28 | Invitation / Share / Deletion / Offline / 404 | 执行中 | 已确认 Auth/Onboarding 依赖完成；下一步先写 RED 合同并审计现有主体，再逐页迁移。                                                                                                                                                    |
| 2026-08-28 | Invitation / Share / Deletion / Offline / 404 | 已完成 | PublicFlowShell 与五类 route-specific 主体完成；真实 API/权限/隐私/恢复语义保留；5 类流程 × 320/390/1024/1440 浏览器审计、Axe、溢出、唯一 primary、reduced-motion、键盘焦点和 runtime console 通过；报告与 20 张 After 截图已归档。 |

## 验证结果

- Web Vitest：70 files / 254 tests passed
- Web typecheck：passed
- Web lint：passed
- Next production build：passed
- Public Flow Playwright：1 test passed，覆盖 5 流程 × 4 视口
- Web image：`sha256:05835b0b7c6ba349dc11c39ba0b2af64bee016921ce970ef46f4f051d1653d03`，无源码挂载
- Conformance 报告：[public-flows-conformance.md](../../../reports/ui-refactor/public-flows-conformance.md)
- Browser evidence：[public-flows-browser-evidence.json](../../../reports/ui-refactor/public-flows-browser-evidence.json)

## 偏离说明

- 历史公共流程 Before 同视口原图缺失，报告如实记录，不伪造。
- GLM 仅提供部分公共流程 1440/390 Target，其余断点按固定 Shell、响应式和无障碍合同验收。
- 浅色 warning 状态图标原 token 在混合背景上为 4.48:1，已用 `#7f4b00` 修正至 AA；暗色 token 保持不变。

## 后续门禁

步骤 14 技术工作已完成，但不单独请求 PO 归档；按父计划决策，等待步骤 15 与全量路由完成后统一交 GLM/PO Gate 2，随后执行最终 review。
