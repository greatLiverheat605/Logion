# Collaboration GLM 一致性验收报告

## 当前结论

Collaboration 已完成主体工作台实现与真实任务质量门。正式页面从共享 `OfflineLearningCenter` 中旧的 `ProductPanel`、纵向 `planning-form` 和混合操作区，重构为专属的 `Review Master / Rubric & Feedback Main / Member Inspector` 工作台。

- Collaboration Workbench 结构：已完成
- 旧 Collaboration `ProductPanel` 主体：已从运行代码移除
- Shared Space 双重边界过滤：已保留
- Rubric → Review → Feedback → Immutable Snapshot：真实闭环通过
- Web typecheck、lint、Vitest：通过
- 8080 Web 镜像：已重建并切换到最终无挂载镜像
- Playwright 真实任务、四断点、Axe、键盘/焦点、reduced-motion、overflow、唯一 primary 和 runtime console：通过
- Product Owner 独立验收：待确认（请回复 `Collaboration 独立验收通过`）

本轮没有改变 API、contracts、注册策略、权限模型、Vault 或 sync-v1。真实任务使用显式本地测试账号和 Vault 口令完成，凭据只存在于当前 Playwright 进程环境，不写入仓库、计划或报告。

## 运行环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/collaboration` |
| Compose project | `logion-b1` |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Git dirty 摘要 | 工作区存在计划内既有未提交变更；本轮 Collaboration 源文件、CSS、测试与报告未提交 |
| Web image | `logion-web:dev` |
| Web image ID | `sha256:ae2c201961d7fe5b0a5505ddccd49692e9af899e7f54723ddc2ca0a01a86c4c9` |
| Web image Created | `2026-08-27T10:47:42.704005410Z` |
| Web container Started | `2026-08-27T10:47:55.224965259Z` |
| Reverse-proxy Started | `2026-08-27T10:48:06.000281844Z` |
| Web mounts | `[]` |
| API image | `sha256:50091724b45d088a276466b483addb4619555c8d640e4887694f0e975dcd8f12` |
| API / DB / Redis / Worker / Proxy | 全部 healthy，`/healthz` 返回 `200`；8080 origin 与 WebAuthn RP 配置匹配最终验收入口 |
| 业务 mock | 无 |

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无历史同视口 Before | 未交付该视口 Target；以 GLM specs 与响应式合同为准 | [`after/app-collaboration-320x640.png`](after/app-collaboration-320x640.png) |
| 390 x 844 | 无历史同视口 Before | `app_collaboration-390x844.png`（manifest 校验） | [`after/app-collaboration-390x844.png`](after/app-collaboration-390x844.png) |
| 1024 x 768 | 无历史同视口 Before | 未交付该视口 Target；以 GLM specs 与响应式合同为准 | [`after/app-collaboration-1024x768.png`](after/app-collaboration-1024x768.png) |
| 1440 x 900 | 无历史同视口 Before | `app_collaboration-1440x900.png`（manifest 校验） | [`after/app-collaboration-1440x900.png`](after/app-collaboration-1440x900.png) |

不缩放、不裁切或伪造 Before / After。真实 After 截图来自完成登录、Vault 解锁、创建共享 Rubric、发起审阅、提交反馈并发布快照的最终无挂载 Web 镜像；缺失的历史 Before 与 320/1024 Target 按证据限制登记。

### After 截图 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app-collaboration-320x640.png` | `ACDB198B5846AD1E0FEED1CB7F00203F4158BBB66D0BA931ADA1C73AC5378CC7` |
| `app-collaboration-390x844.png` | `034F94ECBD34FA073F501B104ECD0CEDA1CAE68C46081F43E25D117B7B5AC30B` |
| `app-collaboration-1024x768.png` | `F4EBE1EDF497C3567260E2279D519C8145E5F122BB001BB1B561B7F4F8575CF9` |
| `app-collaboration-1440x900.png` | `1959127575BDCE4967CA12FF5159C40B6171BE92016EADB2E31A0F337E75C3DC` |

## 主体结构差异

### Before

```text
OfflineLearningCenter(mode="collaboration")
├─ ProductPageHeader + locked / empty 状态
├─ Workspace / Space / Vault Disclosure
├─ Rubric、Review、Feedback、Snapshot 纵向 planning-form
└─ ProductPanel 混合显示共享记录与操作
```

### After

```text
Collaboration Workbench
├─ Workbench Header + 当前上下文唯一 primary
├─ Shared Space Context Bar + Workspace / Space / 权限 / Vault / Sync
├─ Review Master
│  ├─ Shared Space summary
│  ├─ Review queue
│  └─ Rubric 入口
├─ Rubric & Feedback Main
│  ├─ Review Header + 状态
│  ├─ Rubric criteria
│  ├─ Feedback Timeline
│  └─ Immutable Report Snapshots Tab
└─ Member Inspector
   ├─ 当前角色与能力
   ├─ Shared Space scope
   └─ Private data exclusion
```

1440 px 使用 264px Master、弹性 Main、316px Inspector；1024 px 和移动端进入连续主列。创建 Rubric、发起 Review、提交 Feedback、发布 Snapshot 均使用 Radix Sheet；失败时 Sheet 保留输入，成功后才关闭。

## 主任务与 Function Reachability

```text
自动带入 Workspace / Shared Space / 权限
→ locked 时从唯一 primary 打开 Unlock Sheet
→ 解锁 Vault 并执行 sync-v1 bootstrap
→ 创建 Rubric
→ 发起共享 Review
→ 追加 Feedback 与建议动作
→ 输入 PUBLISH 确认并发布不可变 Snapshot
→ Inspector 回显角色能力、共享范围与 Private 排除
```

| 正式能力 | 新入口 | 当前验证 |
| --- | --- | --- |
| Workspace / Shared Space / current device 加载 | Context Bar + Toolbar | 真实 Session/API 页面通过，Private Space 不进入 Collaboration 选择 |
| Vault 解锁与 bootstrap | Header primary → `解锁共享审阅资料` Sheet | 真实本机口令通过；Sheet 自动聚焦并恢复触发按钮 |
| `rubric` | Master / Inspector `创建 Rubric` → Sheet | 真实创建并回显 Rubric 数量与标准 |
| `group_review` | Header primary `发起审阅` → Sheet | 真实绑定 `rubric_id` 并回显 Review queue |
| `group_feedback` | Header primary `提交反馈` → Sheet | 真实绑定 `review_id` 并追加时间线与建议动作 |
| `report_snapshot` | Review action menu → Sheet | `PUBLISH` 短语通过后真实追加只读快照；错误短语保留 Sheet |
| Shared / Private 边界 | controller `eligibleCollaborationSpaces` + view filters + Inspector | Private Space 不可选、不读取、不写入、不展示 |
| 角色能力 | Member Inspector + action disabled state | Owner/Admin/Editor 可规划与发布；Reviewer/Contributor 可反馈；Viewer 无写入能力 |
| 同步与错误恢复 | Context Toolbar / State Notice | `sync-v1`、Outbox、请求编号和恢复语义未改 |

## 状态与危险操作

`loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale` 继续由正式 `ProductWorkbenchState`、controller 副作用和 `sync_status` 驱动。不可变快照 Sheet 明确显示影响范围、所需权限、不可编辑语义和恢复路径；修正只能追加新版本。

## 验证记录

```text
pnpm --filter @logion/web typecheck       passed
pnpm --filter @logion/web lint            passed
pnpm --filter @logion/web test -- --run   58 files / 220 tests passed
pnpm --filter @logion/web build           passed
docker compose -p logion-b1 build web    passed (`logion-web:dev`)
/healthz                                  200
pnpm exec playwright test tests/browser/collaboration-workbench.spec.ts --project authenticated-chromium
                                           passed (1 test, 18.5s)
                                           real Session/API/Vault/sync-v1 writes completed
                                           320/390/1024/1440, Axe, keyboard/focus,
                                           reduced-motion, overflow, unique primary and
                                           runtime console checks passed

重建后的环境复核：首次只带默认 Compose origin 时，fixture 收到 `403 AUTH_ORIGIN_INVALID`；随后补齐
`127.0.0.1:8080` 的 allowed origin，并使 WebAuthn RP ID 与该 origin 匹配，API 恢复 healthy，直接登录返回
`200`，完整规格再次通过。配置仅存在于本次 Compose 进程环境，未写入仓库。
```

### 证据边界

- 历史 Collaboration Before 没有可复核的同视口原图，320/1024 的 GLM Target 资产也未交付；本报告不伪造对照图。
- 组件静态合同和真实任务均通过，但仍不能替代 Product Owner 对视觉层级、信息密度和任务路径的人工签字。
- 测试账号和 Vault 口令未写入任何持久化文件；报告只记录运行摘要与测试结论。

## 下一步门禁

Collaboration 技术与真实任务质量门已完成。请 Product Owner 在真实 `http://127.0.0.1:8080/app/collaboration` 中以 1440/390 为主视口、抽查 320/1024，对照 GLM Target 验收 Review queue、Rubric criteria、Feedback timeline、Snapshot Inspector、Private 排除和唯一 primary，并回复：

`Collaboration 独立验收通过`

在该独立验收通过前，不创建 Templates 子计划，也不施工 Templates 路由。
