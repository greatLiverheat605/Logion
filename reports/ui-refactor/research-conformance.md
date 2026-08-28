# Research GLM 一致性验收报告

## 当前结论

Research 已完成主体工作台实现与静态质量门。正式页面已从 `OfflineLearningCenter` 中旧的 `ProductPanel`、搜索栏和纵向 `planning-form` 堆叠，收敛为独立的 `Research Question Master / Claims Main / Evidence Inspector` 工作台，并以 Tabs 承载论文索引、实验与指标。

- Research Workbench 结构：已完成
- 旧 Research `ProductPanel` 主体：已从运行代码移除
- 正式 Research 对象与父依赖：保留
- Web typecheck、lint、Vitest：通过
- 8080 Web 镜像：已重建并切换到 `c11`
- Playwright 真实任务、四断点、Axe、键盘、焦点、reduced-motion、overflow 和唯一 primary：通过
- Product Owner 独立验收：通过（2026-08-27，原文 `Research 独立验收通过`）

本轮没有改变 API、注册策略、权限模型、Vault 或 sync-v1。真实任务使用显式本地测试账号和 Vault 口令完成，凭据只存在于当前 Playwright 进程环境，不写入仓库、计划或报告。

## 运行环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080/app/research` |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Git dirty 摘要 | 工作区存在既有整改未提交变更；本轮 Research 源文件与 CSS 仍未提交 |
| Web image | `logion-web:0.1.0-local-c11` |
| Web image ID | `sha256:3a97c4262c5a0abf4e35fd0485e43f7be6f086f54d0ec5b0276502418a8b238c` |
| Web image Created | `2026-08-27T09:02:29.201276197Z` |
| Web container Started | `2026-08-27T09:05:39.576839691Z` |
| Reverse-proxy Started | `2026-08-27T09:05:50.873458923Z` |
| Web mounts | `[]` |
| API / DB / Redis / Worker / Proxy | 原运行实例保持；`/healthz` 返回 `200` |
| 注册策略 | 正式 `LOGION_REGISTRATION_MODE=invite` |
| 业务 mock | 无 |

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320 x 640 | 无同视口历史证据 | 以 GLM specs 与响应式合同为准；Target 资产未交付该视口 | [`after/app-research-320x640.png`](after/app-research-320x640.png) |
| 390 x 844 | 历史 Before 若存在，实际尺寸须以原图为准 | `app_research-390x844.png`（由 manifest 校验） | [`after/app-research-390x844.png`](after/app-research-390x844.png) |
| 1024 x 768 | 无同视口历史证据 | 以 GLM specs 与响应式合同为准；Target 资产未交付该视口 | [`after/app-research-1024x768.png`](after/app-research-1024x768.png) |
| 1440 x 900 | 历史 Before 若存在，实际尺寸须以原图为准 | `app_research-1440x900.png`（由 manifest 校验） | [`after/app-research-1440x900.png`](after/app-research-1440x900.png) |

不缩放、不裁切或伪造 Before / After。真实 After 截图来自完成登录、Vault 解锁并写入 Research 对象的 `c11` 镜像；缺失的历史 Before 与 320/1024 GLM Target 仍按证据限制登记。

### After 截图 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `app-research-320x640.png` | `B40700EB45F25F1EED2DAF396FC350CEFFE45CF6D2100DDF8F5B91422D98A7CB` |
| `app-research-390x844.png` | `B70801CAC4C8CF25243C979C47E2429436B7FF8E0E41CF31F6DCFC8104A8EC1D` |
| `app-research-1024x768.png` | `2CA1863ABF94CAC91A540721FEF83BB66EB2112E76F1DA2E0B393CD0FCAD3EFF` |
| `app-research-1440x900.png` | `4875F57B1A4A9912E2432CE13FF540B34D051168BE3047A53E8A0838B89D4409` |

## 主体结构差异

### Before

```text
OfflineLearningCenter(mode="research")
├─ ProductPageHeader + locked / empty 状态
├─ Research summary 指标卡
├─ 论文搜索栏
├─ 论文库 / 研读画布 / 证据进度 ProductPanel
├─ 论文、声明、问题、实验纵向 planning-form
└─ 指标、反馈与实验比较 ProductPanel
```

### After

```text
Research Workbench
├─ Workbench Header + 当前上下文唯一 primary
├─ Context Bar + Workspace / Space / 权限 / Vault / Sync
├─ Research Question Master
│  ├─ 问题列表与选择
│  └─ 论文 / 实验摘要
├─ Claims Main
│  ├─ 研究问题 Header
│  └─ Tabs：声明与证据 / 论文 / 实验与指标
└─ Evidence Inspector
   ├─ 问题链路或声明证据
   ├─ 来源、立场、Vault、权限、Sync
   └─ 反馈追加入口
```

## 正式语义与 Function Reachability

| 正式能力 | 新入口 | 状态 |
| --- | --- | --- |
| Workspace / Space / current device 加载 | Context Bar + controller | 真实 Session/API 页面通过，Context Bar 持续回显 |
| Vault 解锁与 bootstrap | Header primary → `解锁研究资料` Sheet | 真实本机口令通过；Sheet 自动聚焦并恢复触发按钮 |
| `research_question` | Master `新建问题` → Sheet | 代码入口与提交语义保留 |
| `paper_record` | 论文 Tab `索引论文` → Sheet | HTTP(S) URL 校验保留 |
| `research_claim` | Claims `建立声明` → Sheet | `paper_id` 父依赖与四类 stance 保留 |
| `experiment_run` | 实验与指标 Tab `记录已完成运行` → Sheet | `question_id` 父依赖与时区完成时间保留 |
| `metric_record` | 运行行 `指标` → Sheet | `run_id` 父依赖、数值和单位仅追加保留 |
| `research_feedback` | Evidence Inspector `记录反馈` → Sheet | `claim_id` 父依赖与建议动作保留 |
| 同名指标比较 | 实验与指标 Tab | 复用 `ResearchExperimentComparison`，不换算单位 |
| 同步与错误恢复 | Context Toolbar / State Notice | `sync-v1`、Outbox、请求编号和恢复语义未改 |

## 验证记录

```text
pnpm --filter @logion/web typecheck       passed
pnpm --filter @logion/web lint            passed
pnpm --filter @logion/web test -- --run   57 files / 218 tests passed
docker build apps/web                    passed (`logion-web:0.1.0-local-c11`)
/healthz                                  200
pnpm exec playwright test tests/browser/research-workbench.spec.ts --project=authenticated-chromium
                                           passed (1 test, 10.4s)
                                           real Session/API/Vault/sync-v1 writes completed
                                           320/390/1024/1440, Axe, keyboard/focus,
                                           reduced-motion, overflow, unique primary and
                                           runtime console checks passed
```

### 证据缺口

- 历史 Research Before 没有可复核的同视口原图，320/1024 的 GLM Target 资产也未交付；本报告不伪造对照图。
- 真实测试账号和 Vault 口令未写入任何持久化文件；报告只记录运行摘要与测试结论。
- 组件静态合同和真实任务均通过，但仍不能替代 Product Owner 对视觉层级、信息密度和任务路径的人工签字。

## 下一步门禁

Research 的技术与 Product Owner 验收均已完成。下一道门是 Collaboration 的独立实现与真实任务验收；Templates 继续锁定。

## Product Owner 验收记录

- **结果**：通过
- **原文**：`Research 独立验收通过`
- **时间**：`2026-08-27`
- **后续解锁**：允许启动 Collaboration 子计划；Templates 继续锁定。
