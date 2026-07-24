# Phase 5 综合审计与验收记录

- 日期：2026-07-23
- 工作包：`L5-099` / [Issue #131](https://github.com/greatLiverheat605/Logion/issues/131)
- 基线：`LOGION_EXECUTION_PLAN.md`、`LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`

## 结论

在验收 PR 及其最新 `main` 构建成功后，Phase 5 可进入人工阶段批准；不授权 Production。AI 保持可选，所有输出在用户明确决定前均为草稿，核心学习、离线和数据可移植路径不依赖 AI Provider。

## 合并证据

| 能力                                 | PR                                                           | 不可变 Main commit                         |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| 加密 OpenAI-compatible Provider 配置 | [#112](https://github.com/greatLiverheat605/Logion/pull/112) | `16f582f0072ec86d4cd06e2e7bdcee4f8890ca60` |
| DNS 固定模型发现/健康                | [#114](https://github.com/greatLiverheat605/Logion/pull/114) | `c66604eb512b41c46c489da1520d6dcd7a68954e` |
| 路由、固定模型、预算预留             | [#116](https://github.com/greatLiverheat605/Logion/pull/116) | `fbe1cd3b96e9b02f0e0015d39ee36205bf0f12a3` |
| 持久 AI run、取消、人工批准草稿      | [#118](https://github.com/greatLiverheat605/Logion/pull/118) | `0d6b63c14e72e29acd0a2a7f8527b25595ed750b` |
| 版本模板/可撤销只读分享              | [#120](https://github.com/greatLiverheat605/Logion/pull/120) | `a1dbac6d0eb4bd8ba88266b47aa2ea2a7cb047dd` |
| 权限搜索/最小通知/日历               | [#122](https://github.com/greatLiverheat605/Logion/pull/122) | `4898f21ecd57d9eee65863b6c0d76acc76659bae` |
| 加密版本导出                         | [#125](https://github.com/greatLiverheat605/Logion/pull/125) | `c3c32784c01f4d0a97c21a2a3a05a37bb61f132b` |
| preview-first 有界 Private 导入      | [#126](https://github.com/greatLiverheat605/Logion/pull/126) | `8b5f3a20bdca96ef8d247d98d790186e69e6cda4` |
| 可恢复账户删除                       | [#128](https://github.com/greatLiverheat605/Logion/pull/128) | `fb7cafea654d9a463ce16fed3a7b97c933a4e270` |
| 加密备份/空环境恢复                  | [#130](https://github.com/greatLiverheat605/Logion/pull/130) | `1491d1201e5d117c7c6f8369073e854b24257c3d` |

Backup 候选通过 [Nightly 29942294757](https://github.com/greatLiverheat605/Logion/actions/runs/29942294757)，含迁移到 head、加密包验证、空库恢复、附件 marker 和强制更换 `sync_epoch`。综合候选为 [PR #132](https://github.com/greatLiverheat605/Logion/pull/132)，通过 [Fast](https://github.com/greatLiverheat605/Logion/actions/runs/29944066963/job/89004888310) 与 [PostgreSQL/Redis Integration](https://github.com/greatLiverheat605/Logion/actions/runs/29944066963/job/89004888179)，含跨 Private Space 和邀请生命周期负向测试。

## 基线映射

| 基线要求                   | 证据与边界                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 可替换 AI/用户 endpoint    | Provider 属 Workspace，凭据用信封加密且不返回浏览器；首个 adapter 仅 OpenAI-compatible HTTPS                                  |
| SSRF/恶意响应              | URL 禁凭据/query/fragment/非 HTTPS/私有字面量；DNS 全公网，连接 IP 固定，禁 redirect/proxy，响应字节/schema 有界              |
| AI 失败不阻塞核心          | AI 独立排队；错误变稳定失败/降级；planning/execution/content/review/sync/portability 不调用 Provider                          |
| AI 只产草稿                | 输出经 schema 校验存为 `AIOutputDraft`；正式记录只在用户决定并通过 target-version 后改变                                      |
| Template/Share 非 ACL 绕过 | Template 使用不可变结构白名单和新 ID；Share 只含明确字段，只存 purpose-scoped token HMAC，每次公开读检查状态/过期             |
| 搜索先授权                 | 先解析可见 Shared 和请求者 Private；POST query 不进审计；离线只查已解锁加密本地 cache                                         |
| 最小通知/可撤销日历        | 有界 summary，安全通知不可关，重查目标权限；Calendar token 一次返回/HMAC 存储，只投影标题/日期                                |
| 用户导出/安全导入          | Export AES-GCM 加密、下载校验并绑定 requester/workspace；Import 四种有界格式，不抓取/执行，预览后只在 owned Private 生成新 ID |
| 可恢复删除                 | recent auth/CSRF/确认/限速；立即撤销访问/link；14 天默认宽限只可查看/取消；到期清理并假名化保留归属                           |
| 备份/空恢复                | PostgreSQL dump、附件、manifest 以 AES-256-GCM 认证；拒绝危险成员/非空目标并重置所有 sync epoch                               |
| 动态上下文                 | 生产路径无真实教师、实验室、学校、公司、考试、方向或日程；Persona 为组合能力，内容由用户创建/导入/安装                        |

## 综合安全审查

验收按 `security-review` 检查认证、授权、secret、输入边界、注入、CSRF、限速、错误/日志和依赖。Phase 5 React 仍保持性能边界：离线搜索仅在解锁后动态加载，不进入在线首包。

发现并修复四项缺陷：

1. 无直接 `space_id` 的 Export 后代（`PlanVersion`/`PlanPhase`）继承父 Plan 的 Space 授权，防止他人 Private Plan 进入导出。
2. Share 列表/撤销要求源 Space 权限，Editor 不能查看或撤销他人 Private Share。
3. 删除账户时锁定 sole-owned Workspace 的 pending invitation，复核成员并撤销删除者发出的仍 pending 邀请，关闭 invite/deletion 竞态。
4. `tasks.csv` 中和 spreadsheet formula 前缀；权威原值仍在 `data.json`。

普通响应、审计和导出均不含 Provider credential、backup/export/import key、session、recovery material、share/calendar token 或保留 AI 输入。用户输入不拼接 SQL，ID/sort 均参数化或白名单。

## 验证矩阵

| 门禁                 | 必需结果                                                                             |
| -------------------- | ------------------------------------------------------------------------------------ |
| Python unit/security | Export/import crypto/parser、backup envelope/archive、CSV 防护通过                   |
| PostgreSQL/Redis     | 跨 Space export、Private share 管理、deletion-invitation 负向及 Phase 1–5 全集成通过 |
| 契约/迁移            | OpenAPI 干净，head=`0031_account_deletion`，空库升级通过                             |
| Web/offline          | 递归 TS tests、strict type、format、production build、dynamic-context 通过           |
| 供应链               | Secret scan、dependency audit、冻结安装通过                                          |
| 恢复                 | Nightly backup→verify→empty restore→attachment→new epoch 通过                        |

最新 `main` 链接在 Phase 5 Issue 关闭前记录；失败或被替代 run 不作为证据。

## 兼容与回滚

验收修复不增加迁移，也不改变 OpenAPI、IndexedDB 或 sync schema，只收窄服务端读取、在既有删除事务撤销邀请并转义 CSV 投影。机械回滚会重新引入已确认漏洞，因此不批准；运行回归应前向修复。

## Phase 6 输入与残余风险

1. 配置异账户/区域不可变异地备份、KMS/key escrow、保留锁和告警；Compose 卷只为同机恢复。
2. 附件卷提升和 Production 恢复保持人工批准，并演练生产等价 RPO/RTO。
3. 大型加密 Export 迁到私有对象存储，不削弱生命周期、完整性、requester 授权和 cache 控制。
4. 首版 Import 只支持 Note/Resource/Paper/InboxItem；不支持项在预览警告，不是完整 Workspace 恢复。
5. 公开发布前由隐私/法务批准宽限期、备份到期披露和 Shared Space 贡献保留。
6. Phase 6 必须完成容量、PWA、WCAG 2.2 AA、安全扫描、观测、告警、staging 迁移、RC 和人工生产批准；本文不授权 Production。
