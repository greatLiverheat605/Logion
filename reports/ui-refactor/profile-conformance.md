# Profile GLM 一致性验收报告

## 当前结论

`/app/profile` 已从静态占位 `ProductPanel` 重构为真实账户工作台。页面只展示当前 `Session` 已确认的身份、验证和时间字段，不虚构个人资料；安全、设置和数据操作通过真实专门路由继续完成。

- GLM 目标结构：`AppShell → AccountSummary → PersonalActivity → AccountActions`
- Main：账户摘要、个人活动时间线、账户入口
- Master：账户摘要、活动记录、账户入口导航
- Inspector：Session 绑定、验证状态、本人权限边界和恢复帮助
- 技术门禁：定向 1 file / 1 test、全量 69 files / 250 tests、typecheck、lint、Next 16 production build 通过
- Product Owner / GLM 统一视觉验收：待真实 Session、四视口截图和人工走查

## GLM Target

Target 根目录：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| Target | SHA-256 |
| --- | --- |
| `app_profile-390x844.png` | `c7d623ee0b6b9ecc0cbc627b30706169a0919906ffdbc707e4aa4880db38a979` |
| `app_profile-1440x900.png` | `6d268b6454886c56ca3d86063784871c1d5a3ceff3b7383016ab5019e2b95dab` |

## Before / After

### Before

```text
ProfilePage
├─ ProductPageHeader
└─ “个人资料” ProductPanel
   └─ “更多字段将在后续版本开放”占位文本
```

### After

```text
Profile Workbench
├─ Workbench Header + Session / 权限 / 会话安全 Context Bar
├─ Account Master
│  ├─ 账户摘要
│  ├─ 活动记录
│  └─ 账户入口
├─ Account Main
│  ├─ Account Summary：邮箱、ID、状态、验证和到期时间
│  ├─ Personal Activity：当前会话、账户创建、验证状态时间线
│  └─ Account Actions：安全、设置、数据真实深链
└─ Account Inspector
   ├─ Session 绑定与验证状态
   └─ 权限边界与恢复帮助
```

## Function Reachability

| 能力 | 新入口 | 保留语义 |
| --- | --- | --- |
| 查看身份 | Account Summary | 只读取 `useSession` 的真实 UserResponse |
| 查看邮箱验证 | 摘要 / 活动时间线 | `email_verified_at` 为 null 时明确显示待处理 |
| 查看 Session | 摘要 / 活动时间线 | 使用真实 `sessionExpiresAt`，错误态保留 request ID |
| 账户安全 | Account Actions → `/app/security` | Passkey / TOTP / 设备撤销仍在安全中心完成 |
| 个人设置 | Account Actions → `/app/settings` | Persona / 主题 / 导航仍在设置工作台完成 |
| 数据边界 | Account Actions → `/app/data` | 导入、导出、删除和恢复仍受原权限确认约束 |
| 恢复帮助 | Inspector → `/app/help` | 真实帮助与诊断深链 |

## 验证记录

```text
pnpm --filter @logion/web exec vitest run src/app/app/profile/profile-workbench.test.tsx
  passed: 1 file / 1 test
pnpm --filter @logion/web test
  passed: 69 files / 250 tests
pnpm --filter @logion/web typecheck
  passed
pnpm --filter @logion/web lint
  passed
pnpm --filter @logion/web build
  passed (Next.js 16.2.11, 35 routes)
```

## 证据缺口

历史 Profile Before 同视口原图未在当前工作区找到；After 尚未从最新无源码挂载 8080 镜像采集。真实 Session、320 / 390 / 1024 / 1440、Axe、键盘/读屏、reduced-motion、overflow、runtime console 和 PO/GLM 视觉层级签字待补。静态合同不替代真实验收。
