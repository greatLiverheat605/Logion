# Settings GLM 一致性验收报告

## 当前结论

`/app/settings` 已完成主体工作台重构，旧的 `ProductPanel` 与互操作说明主体已从 Settings route 移除。页面现在以设置分组为 Master、当前分组为 Main、偏好边界为 Inspector，低频自定义画像编辑进入 Radix Sheet。

- GLM 目标结构：`AppShell → GroupedSettingsList → SecondarySettingsSheet`
- 分组区域：学习画像、界面与交互、操作偏好、导航入口
- 真实语义：`usePersona`、`ThemeToggle`、自定义画像创建/删除/切换保持不变
- 旧主体排除：运行 route 不再渲染 `.product-panel` 或旧互操作入口
- 技术门禁：定向 1 file / 1 test、全量 69 files / 250 tests、typecheck、lint、Next 16 production build 通过
- Product Owner / GLM 统一视觉验收：待真实 Session、四视口截图和人工走查

## GLM Target

Target 根目录：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| Target | SHA-256 |
| --- | --- |
| `app_settings-390x844.png` | `977b949dc36bd6528376f4a2d5ecbe3b77a7bab8b68301577c430c24766afe7a` |
| `app_settings-1440x900.png` | `425e7432b20dd38eb6a8a42d141d0bc74400462570d80e2e1ccb6e7ef234b7ba` |

## Before / After

### Before

```text
SettingsPage
├─ ProductPageHeader
├─ PersonaSettings 外层主体
├─ 互操作与自动化边界 ProductPanel
└─ 连接器 / 数据 / AI / Search 链接混在页面底部
```

### After

```text
Settings Workbench
├─ Workbench Header + 当前账户 / Sync / Vault Context Bar
├─ Grouped Settings Master
│  ├─ 学习画像
│  ├─ 界面与交互
│  ├─ 操作偏好
│  └─ 导航入口
├─ Settings Main
│  ├─ 当前分组专属列表或主题控制
│  └─ 唯一主操作：新建自定义画像（仅画像分组）
├─ Preference Inspector
│  ├─ 当前画像、可见入口、保存范围
│  └─ 安全边界与安全中心入口
└─ Secondary Settings Sheet
   └─ 自定义画像名称、图标、说明和可见入口
```

## Function Reachability

| 能力 | 新入口 | 保留语义 |
| --- | --- | --- |
| 切换内置画像 | 学习画像列表行 | `setActivePersona`，导航入口仍受画像控制 |
| 创建自定义画像 | 画像分组唯一 primary → Sheet | `createCustomPersona`，必需路由自动补齐 |
| 删除自定义画像 | 对应行危险动作 | `deleteCustomPersona`，失败保留当前状态 |
| 主题切换 | 界面与交互分组 | 复用 `ThemeToggle` 与本机主题持久化 |
| 导航入口审查 | 导航入口分组 | 必需的每日 / 设置 / 个人 / 帮助入口持续回显 |
| 安全恢复 | Inspector → 安全中心 | `/app/security` 真实深链，不绕过权限 |

## 验证记录

```text
pnpm --filter @logion/web exec vitest run src/app/app/settings/settings-workbench.test.tsx
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

历史 Settings Before 同视口原图未在当前工作区找到；After 尚未从最新无源码挂载 8080 镜像采集。真实 Session、320 / 390 / 1024 / 1440、Axe、键盘/读屏、reduced-motion、overflow、runtime console 和 PO/GLM 视觉层级签字待补。静态合同不替代真实验收。
