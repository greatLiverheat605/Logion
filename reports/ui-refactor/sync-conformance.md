# Sync GLM 一致性验收报告

## 当前结论

Sync 已从旧的 `ProductPanel` / `sync-grid` 堆叠重构为专属 `Sync Summary + Master / Main / Inspector + Operational Tabs` 工作台。controller 的 sync-v1、Vault、Bootstrap、Outbox、409、附件和设备语义保留；自动化与 production build 通过。真实登录后的四断点视觉走查尚未完成，不能替代 PO 验收。

## Before / GLM Target / After

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 历史同视口原图未纳入当前证据 | 按 `app_sync-390x844.png` 与响应式合同收敛 | 待真实登录截图 |
| 390 x 844 | 历史同视口原图未纳入当前证据 | `app_sync-390x844.png` | 待真实登录截图 |
| 1024 x 768 | 历史同视口原图未纳入当前证据 | 按 Workbench 几何与响应式合同收敛 | 待真实登录截图 |
| 1440 x 900 | 旧版网络/Vault/冲突/附件混成 2611px 纵向流 | `app_sync-1440x900.png` | 待真实登录截图 |

GLM Target 根目录：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`。

## 主体结构差异

### Before

```text
ProductPageHeader
└─ sync-grid
   ├─ 五个 metric card
   ├─ Connection card
   ├─ Topology card
   ├─ Vault form
   ├─ Conflict card + nested cards
   ├─ Attachment card
   └─ Device clear card
```

### After

```text
Sync Workbench
├─ Sync Summary Context Bar
├─ Sync Control Master
│  ├─ Workspace
│  └─ Outbox / 冲突 / 附件 / 设备
├─ Diagnostics Main
│  ├─ 唯一 primary：立即同步 / 冲突存在时处理冲突
│  ├─ Outbox table
│  ├─ 409 local/remote compare + explicit actions
│  ├─ Attachment queue + quota boundary
│  └─ Device topology + local data danger zone
└─ Sync Inspector
   ├─ Workspace / network / last sync / device
   ├─ Vault unlock / lock
   └─ status / recovery copy
```

## Function Reachability

| 能力 | 新入口 | 状态 |
| --- | --- | --- |
| Workspace/device context | Summary + Master + Inspector | 真实 controller 已接入；浏览器走查待登录 |
| Bootstrap 分块拉取 | `立即同步` + Bootstrap state notice | 真实 controller 保留；状态块已覆盖 staging/rebootstrap |
| Outbox | Outbox Tab | `outbox_state`、operation_id、payload_hash、attempt_count、last_error_code 已展示 |
| 409 冲突 | `处理冲突` → 冲突 Tab | keep local/remote/merge、dismiss、复制本地均可达 |
| 附件上传 | 附件队列 Tab | pending/failed 重试、失败原因和服务器 quota 校验边界已展示 |
| 设备 | 设备 Tab | 当前/授权/撤销状态已展示；细粒度 trust level 明确转由安全中心 |
| 本机数据清除 | 设备 Tab 危险区 | 影响范围、不可恢复、Bootstrap 恢复路径、确认短语保留 |
| offline/locked/permission/stale | Summary + State Notice | 视图出口已实现；真实 Session 走查待补 |

## 自动化与运行证据

- Web：`62 files / 235 tests`、typecheck、lint、Next production build 全通过。
- 新增 `sync-workbench.test.tsx`：3 tests 通过；旧 `真实同步拓扑与设备` / `同步队列诊断` 浏览器断言已改为新区域合同。
- Web image：`sha256:a820997e3a5cade9852e0b5bc3a491a72a8278384896a9e0af9e023124f9c9b7`，mounts `[]`，8080 `/health=200`。
- 真实浏览器当前访问 `/app/sync` 得到“需要登录”，未输入敏感凭据，故暂无 After 截图、Axe、键盘/焦点和四断点人工证据。

## PO 走查清单

1. 登录后确认 Summary 持续回显 Workspace、网络、Vault、冲突和 epoch。
2. 在线执行同步；离线确认按钮禁用原因和 Outbox 本地优先说明。
3. 用真实 409 冲突完成保留本地、保留远端、编辑合并、暂不处理与复制本地新对象，确认不会静默覆盖。
4. 检查附件失败原因/重试和设备授权/撤销/清除本机数据确认流程。
5. 访问 `/app/sync?tab=conflict` 检查深链与冲突空态/锁定态。
6. 以 1440、390 主视口，抽查 320、1024，检查无溢出、唯一 primary、键盘焦点、reduced-motion 和 Screen Reader。

## 偏离与证据边界

| 项目 | 原因 | 替代 | 状态 |
| --- | --- | --- | --- |
| 信任等级字段 | 当前正式 `DeviceResponse` 无 trust level 字段 | 明确展示授权/撤销/current，并引导安全中心管理细粒度 trust | 已登记，待 PO 接受 |
| 附件剩余额度 | 当前附件 API 仅在 init 时校验 quota，不返回可读余额 | 显示服务器校验边界，不伪造剩余额度 | 已登记，待 PO 接受 |
| Before/After 截图 | 当前浏览器无登录 Session，敏感凭据需用户确认 | 登录后补四断点截图和哈希 | 待补，不宣称通过 |
