# Help GLM 一致性验收报告

## 当前结论

`/app/help` 已从单个画像说明占位面板重构为自助排查工作台。搜索是首交互；环境诊断由浏览器网络、真实 Session 和 Vault provider 驱动；恢复路径均指向现有安全、同步、数据和登录流程。

- GLM 目标结构：`AppShell → HelpSearch → EnvironmentDiagnostics → RecoveryPaths → FAQ`
- 搜索输入：唯一 `data-workbench-primary="true"`，支持关键词过滤
- 状态覆盖：online / offline、Session loading / anonymous / error、Vault locked / unlocking / unlocked / clearing
- 旧主体排除：运行 route 不再渲染 `.product-panel`
- 技术门禁：定向 1 file / 1 test、全量 69 files / 250 tests、typecheck、lint、Next 16 production build 通过
- Product Owner / GLM 统一视觉验收：待真实 Session、四视口截图和人工走查

## GLM Target

Target 根目录：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| Target | SHA-256 |
| --- | --- |
| `app_help-390x844.png` | `6d92293ffe7af212d6aba173c691e54e6a75fd8f28f8b02a1337dfe294fe9567` |
| `app_help-1440x900.png` | `12c1a652e5a78542410096d91fb0c9c81b5567a894d8dce5ae5d78e0fe99b6a6` |

## Before / After

### Before

```text
HelpPage
├─ ProductPageHeader
└─ “画像与权限” ProductPanel
   └─ 静态解释，没有搜索、诊断或恢复动作
```

### After

```text
Help Workbench
├─ Workbench Header + Permission / Sync Context Bar
├─ Help Search Main
│  ├─ 搜索首交互与键盘提示
│  └─ FAQ 结果列表与空结果恢复说明
├─ Environment Diagnostics
│  ├─ 网络状态
│  ├─ Session 状态
│  └─ 本机资料状态
├─ Recovery Paths
│  ├─ 账户安全
│  ├─ 同步工作台
│  ├─ 数据主权
│  └─ 重新登录
├─ FAQ
└─ Help Inspector
   ├─ 当前环境
   ├─ 恢复边界
   └─ 搜索状态
```

## Function Reachability

| 能力 | 新入口 | 保留语义 |
| --- | --- | --- |
| 帮助搜索 | Search Main 唯一 primary | 本地 FAQ 过滤，不伪造服务端搜索结果 |
| 网络诊断 | Environment Diagnostics | 监听 `online` / `offline` 浏览器事件 |
| Session 诊断 | Environment Diagnostics | 使用 `useSession` 的真实状态与 request ID |
| 本机资料诊断 | Environment Diagnostics | 使用 `useVaultSession` 的 phase / revision |
| 安全恢复 | Recovery Paths → `/app/security` | 原有登录凭据、TOTP、设备会话流程 |
| 同步恢复 | Recovery Paths → `/app/sync` | Outbox、冲突、附件和设备诊断流程 |
| 数据恢复 | Recovery Paths → `/app/data` | 导入、导出、删除恢复与权限确认流程 |
| 重新认证 | Recovery Paths → `/auth/login` | 正式认证与 Session 恢复流程 |

## 验证记录

```text
pnpm --filter @logion/web exec vitest run src/app/app/help/help-workbench.test.tsx
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

历史 Help Before 同视口原图未在当前工作区找到；After 尚未从最新无源码挂载 8080 镜像采集。真实 Session、320 / 390 / 1024 / 1440、Axe、键盘/读屏、reduced-motion、overflow、runtime console 和 PO/GLM 视觉层级签字待补。静态合同不替代真实验收。
