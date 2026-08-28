# 公共流程 GLM 一致性验收报告

## 当前结论

Invitation、Share、Account Deletion、Offline 与 404 已完成主体级 Public Flow 重构与真实浏览器审计。实现使用独立 `PublicFlowShell`、状态区域、影响范围/权限说明、恢复入口和宽版只读快照布局，没有把旧 `ProductPanel` 包在外层，也没有复制 GLM fixture、hash router 或 mock 数据。

- Public Flow Workbench 结构：已完成
- 邀请摘要、服务端确认、角色边界和恢复入口：可达
- 分享只读快照、失效隐私边界和 noindex/no-referrer：可达
- 删除影响范围、受限权限、确认短语和恢复路径：可达
- Offline 本地继续工作、同步恢复和网络状态：可达
- 404 状态、Today/登录/首页恢复入口：可达
- 真实浏览器 5 类流程 × 4 视口：通过
- Axe、横向溢出、唯一 primary、reduced-motion、键盘焦点和 runtime console：通过
- Web typecheck、lint、Vitest、Next production build：通过
- Product Owner / GLM 统一 Gate 2：待全量路由完成后执行，当前不归档父计划

本轮只修改公共流程视图、共享公共流程 CSS、截图证据与浏览器审计；没有新增 API、权限、Vault、sync-v1 或对象语义。预期的分享 `404`、删除未认证 `401` 和无效地址 `404` 被记录为安全状态，不被误判为客户端运行时故障。

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080` |
| Compose project | `logion-b1` |
| Git HEAD | `70bb0a2b6d9d74a69118a649dfab750e6dd5adc6` |
| Git dirty 摘要 | 计划内工作区存在未提交变更；本报告和公共流程审计为本轮新增 |
| Web image | `logion-web:0.1.0` |
| Web image ID | `sha256:05835b0b7c6ba349dc11c39ba0b2af64bee016921ce970ef46f4f051d1653d03` |
| Web image Created | `2026-08-27T19:30:19.782690318Z` |
| Web container Started | `2026-08-27T19:30:23.821165173Z` |
| Web mounts | `[]` |
| API / DB / Redis / Proxy | 现有 `logion-b1` 服务保持运行，`/healthz` 返回 `200` |

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

历史版本没有可追溯的公共流程同视口 Before 原图，因此不伪造或缩放 Before。Target 只为部分公共流程提供 `1440x900`，其余断点按批准的 GLM specs、公共 shell 合同和移动可访问性偏离验收。

| 流程 | Before | GLM Target | After |
| --- | --- | --- | --- |
| Invitation | 无可复核的历史同视口原图 | `pub_invite-1440x900.png`（SHA-256 `6F280ECE7D45630A154611BD235DA281451261E7B5FD5F2B097159CF1EE9310B`） | `after/public-invite-{320x640,390x844,1024x768,1440x900}.png` |
| Share valid/revoked | 无可复核的历史同视口原图 | `pub_share-valid-1440x900.png`、`pub_share-revoked-1440x900.png`（分别为 `13CC4572FBA579EBA0D95C24AF6676B9ABC4E6A521F1D58CE5EE135587B73A3D`、`04D48607C748DF546522C031807601A8B3EBF9F4BFDDBE80E56F895528A45777`） | `after/public-share-invalid-{320x640,390x844,1024x768,1440x900}.png` |
| Account Deletion | 无可复核的历史同视口原图 | `pub_deletion-1440x900.png`（SHA-256 `56F7F0720699AE88F2B0E0707AE21EAF8FBB306105FE0BAAC0AA0B0EC6D4C3B6`） | `after/public-deletion-unauthenticated-{320x640,390x844,1024x768,1440x900}.png` |
| Offline | 无可复核的历史同视口原图 | `pub_offline-390x844.png`、`pub_offline-1440x900.png`（分别为 `AA397B500AB10DBB00887AAF8F1E2D83100D276E8338DE7665F12B0628B1E393`、`2AA44980F3B1896A3CC2EFC2A3BAB768F8CECF335C8EB056FD7E669B2A77CB68`） | `after/public-offline-{320x640,390x844,1024x768,1440x900}.png` |
| 404 | 无可复核的历史同视口原图 | `pub_not-found-1440x900.png`（SHA-256 `9DB403DCE60AFD3C9DE0083EF3D62136B1716F777D0894B4F34C10567C30DCE0`） | `after/public-not-found-{320x640,390x844,1024x768,1440x900}.png` |

完整 After 文件路径、视口、SHA-256 和 runtime 记录见 [`public-flows-browser-evidence.json`](public-flows-browser-evidence.json)。

## 主体结构差异

### Invitation

Before 是认证表单式邀请入口，目标 Workspace、角色和恢复动作混在一条表单流中。After 是 `PublicFlowShell → Invitation Header → Invitation Summary → Permission Boundary → Accept Action → Recovery Nav`；令牌只从地址片段消费，Workspace 和角色只在真实接受成功后由服务器回显。

### Share

Before 是窄容器中的通用分享内容。After 是 `PublicFlowShell(wide) → Read-only Header → Metadata Region → Snapshot View → Privacy/Recovery State`；快照使用递归结构化 Data View，失效、过期和撤销统一为不可枚举的失败状态，不泄露对象存在性。

### Account Deletion

Before 将删除状态、权限和恢复动作纵向混排。After 是 `PublicFlowShell → Recovery Header → Impact Region → Restricted Permission Region → Confirmation Region → Recovery Region`；未认证进入明确恢复错误，已认证时保留 server version、CSRF、固定确认短语和宽限期恢复。

### Offline / 404

Before 只有通用异常提示或静态空白。After 分别提供网络状态、本地能力边界、同步恢复入口，以及无效地址状态、Today/登录/首页三条恢复路径；没有伪造已同步或当前权限。

## 主任务与交互路径

```text
Invitation: 读取片段令牌 → 查看边界 → 唯一 primary 接受 → 真实 Workspace/角色回显 → 工作区
Share: 读取短期 token → 只读 metadata → 浏览不可变 snapshot → 到期/撤销统一失败 → 首页或登录
Deletion: 读取删除状态 → 查看影响与权限 → 输入 KEEP MY ACCOUNT → 服务器取消 → 重新登录/账户恢复
Offline: 查看网络状态 → 继续已解锁本地工作 → 重试连接或打开 sync-v1 冲突入口
404: 确认地址无效 → 返回 Today、登录或首页
```

## Function Reachability 与状态

| 能力/状态 | 新入口与验证 |
| --- | --- |
| 邀请接受 | `POST /api/v1/invitations/accept`；唯一 primary，失败保留请求编号和登录/注册恢复入口 |
| Workspace / 角色安全边界 | 接受前只显示“服务器确认”，不从 token 推断 Workspace/role；成功后回显真实 `WorkspaceResponse` |
| 分享只读 | `GET /api/v1/shares/{token}`；结构化 snapshot、对象类型、到期时间和 noindex/no-referrer 保留 |
| 分享失效隐私 | 真实无效 token 显示“不存在、已过期或已被撤销”，不区分对象是否曾存在 |
| 删除恢复 | 真实 `GET /api/v1/account-deletion` 与 `POST /api/v1/account-deletion/cancel`；保留 version、CSRF、最近认证和固定短语 |
| 删除五要素 | 影响对象、作用范围、权限限制、确认短语、不可逆边界/恢复路径均可见 |
| Offline | `navigator.onLine` 与 online/offline 事件驱动状态；本地写入不被标记为云端成功，sync-v1 冲突入口可达 |
| 404 | Next not-found 状态不改变数据/权限，Today、登录、首页恢复动作可达 |
| loading / error / permission | PublicFlowState 专属视觉与恢复动作；真实 `401/404` 只作为已知 API 状态记录 |

## 验证记录

```text
pnpm --filter @logion/web test                       passed (70 files / 254 tests)
pnpm --filter @logion/web typecheck                  passed
pnpm --filter @logion/web lint                       passed
pnpm exec playwright test tests/browser/public-flows-conformance.spec.ts \
  --project=public-chromium                          passed (1 test, 16.3s)
docker compose -p logion-b1 --env-file .env.example build web      passed
docker compose -p logion-b1 --env-file .env.example up -d --no-deps web passed
/healthz                                               200
```

浏览器审计使用真实 `127.0.0.1:8080`、无源码挂载镜像、5 个公共流程和 320/390/1024/1440 四个视口。Axe 覆盖 WCAG 2.2 AA；每个流程核对根节点与元素横向溢出、最多一个可见 `[data-workbench-primary="true"]`、reduced-motion、Tab 后可见焦点和 runtime console。分享 `404`、删除 `401`、无效地址 `404` 是预期安全响应，单独列入允许状态。

## 偏离与证据边界

| 项目 | 原因 | 范围与替代 | 审批状态 |
| --- | --- | --- | --- |
| 公共流程无历史 Before 同视口原图 | 原始审计资产缺少可追溯的公共流程 Before | 如实标记缺口，不缩放、不裁切、不伪造 | 待统一 GLM/PO Gate 2 接受或要求补证 |
| 部分公共流程无 320/1024 GLM Target | 批准 artifact 只交付部分公共断点 | 以 GLM specs、固定 Shell 合同和响应式/无障碍规则验收 | 待统一 GLM/PO Gate 2 接受 |
| 移动端控件至少 44x44px | WCAG 触达要求高于 GLM 40px 视觉控件 | 只扩大点击区，不改变信息层级 | 延续已批准全局偏离 |
| 浅色 warning 状态图标颜色 | 原 token 与混合背景为 `4.48:1`，Axe 不通过 | 公共状态图标使用 `#7f4b00`；暗色保持 `--text-warning` | 本轮技术修正，待统一 GLM/PO 复核 |

## Product Owner / GLM 统一验收

当前不请求独立归档。按已确认决策，等 21 条正式路由与公共流程全部完成后，把本报告、20 张 After、GLM Target 和全量 Function Reachability 一并交给 GLM 做最终视觉/流程验收，再进行最终 review。
