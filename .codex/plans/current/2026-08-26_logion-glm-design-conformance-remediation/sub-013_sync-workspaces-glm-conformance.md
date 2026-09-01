# 子计划：Workspaces、Spaces 与 Sync GLM 一致性整改

## 元信息

- 子计划 ID：`sub-013`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 10 - Workspaces、Spaces 与 Sync
- 状态：技术实现与自动化自检完成，等待真实登录 Session 的 PO 走查
- 依赖：Gate 1 已通过；Templates 已独立验收通过

## 保护边界

- 保留 Workspace、Space、成员、邀请、角色、所有权转移、离开 Workspace、sync-v1、Vault、Outbox、Bootstrap、409 冲突、附件队列、设备撤销和清除本机数据的正式 API/权限/离线语义。
- 不引入新的 Headless UI 或主题库；继续使用现有 Radix adapters 与 Workbench primitives。
- 不复制 GLM fixture store、hash router、静态演示数据或手写 overlay；工作台视图只接收 route-specific controller 的真实数据和命令。

## GLM 目标布局

```text
Workspaces Workbench
├─ Member / Invite / Workspace Info / Danger Tabs
├─ Member governance list
└─ Inspector with role, permission and ownership recovery

Spaces Workbench
├─ Space Directory master
├─ Access Detail main
└─ Access Inspector with visibility and capability state

Sync Workbench
├─ Sync Summary: Workspace / network / Vault / conflict / epoch
├─ Master: Outbox / conflicts / attachments / devices
├─ Main: state-aware Outbox table, 409 compare, attachment queue, device view
└─ Inspector: sync context, Vault unlock/lock and recovery status
```

## 已完成实现

- Workspaces/Spaces 已切换到 `WorkspaceGovernanceRoute` 与 `SpacesRoute`，不再渲染旧 `workspace-center` ProductPanel 主体。
- 新增 `use-workspaces-controller.ts`、`workspace-workbench.tsx`、专属 CSS 与合同测试；邀请、角色、最后 Owner、危险操作和 capability-disabled 入口保持可达。
- Sync controller 保留 bootstrap 分块拉取、push/pull、冲突解析、复制本地新对象、dismiss、附件重试、Vault 解锁/锁定和清除本机数据。
- 新增 `sync-workbench.tsx` 与 `sync-workbench.module.css`；`/app/sync` 只渲染该工作台，不再套旧 `ProductPageHeader` 或 `sync-grid/settings-card` 主体。
- Outbox 使用真实 `outbox_state`、`operation_id`、`payload_hash`、`attempt_count` 和失败码；冲突支持保留本地/远端、编辑合并、暂不处理、复制本地；附件显示失败原因和服务器配额校验边界；设备显示授权/撤销并明确 trust level 由安全中心管理。
- 增加 `loading`、401/403 permission、capability-disabled、Bootstrap staging/rebootstrap、isolated epoch stale、offline、locked 和恢复动作；支持 `/app/sync?tab=conflict` 深链。

## 验证结果

```text
pnpm --filter @logion/web typecheck       passed
pnpm --filter @logion/web lint            passed
pnpm --filter @logion/web test            62 files / 235 tests passed
pnpm --filter @logion/web exec vitest run src/features/sync/sync-workbench.test.tsx
                                           1 file / 3 tests passed
pnpm --filter @logion/web build           passed
git diff --check                          only pre-existing growth-center EOF warning
```

Sync 合同测试固定 `sync-summary`、`sync-outbox`、`sync-conflicts`、`sync-attachments`、`sync-devices`、三栏 test id、四个 Tabs、唯一 page primary、旧主体文案不渲染，以及权限/能力状态出口。

## 运行摘要

| 项目 | 记录 |
| --- | --- |
| Web image | `logion-web:0.1.0` |
| Web image ID | `sha256:a820997e3a5cade9852e0b5bc3a491a72a8278384896a9e0af9e023124f9c9b7` |
| Web image Created | `2026-08-27T16:18:58.552076001Z` |
| Web container Started | `2026-08-27T16:23:42.803610589Z` |
| Web mounts | `[]` |
| API health | `healthy` |
| 8080 `/health` | `200` |
| 真实浏览器 | `/app/sync` 当前重定向登录；未在未确认情况下输入测试密码 |

## 未完成证据与 PO 走查

- 需要在真实登录 Session 下以 1440/390 为主、抽查 320/1024：Outbox 状态、冲突三选一与 dismiss/复制、附件重试、设备撤销/清除短语、Vault locked/unlocked、offline 和 `?tab=conflict` 深链。
- 浏览器当前没有有效会话；由于密码属于敏感数据，自动化不会擅自输入。该缺口不影响代码/类型/单元测试/生产 build，但不能据此宣称真实视觉验收完成。
- PO 统一 GLM 验收仍按父计划执行：所有路由完成后一次性提交 GLM 验收，随后再做最终 review；本子计划不归档父计划。
