# Phase 6 发布加固与验收记录

- 日期：2026-07-23
- 工作包：`L6-008` / [Issue #133](https://github.com/greatLiverheat605/Logion/issues/133)
- 基线：`LOGION_EXECUTION_PLAN.md`、`LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`

## 结论

Phase 6 形成可供最终人工阶段批准的不可变 RC 包。source commit `a9b2f4ac2bc28e4dea89f041914e2d4376258f8d` 对应的仓库实现与自动发布加固范围已完成。本文**不授权 Production**，不声称 GitHub-hosted 容量等同生产，也不替代下述人工/运行阻塞项。

保留的自动化证据中没有已知 P0/P1、租户隔离失败、数据丢失路径、静默冲突、凭据泄露或恢复失败；以后发现任一情况都会使本候选失效。

## 最终同源证据

| 门禁              | 最终 run                                                                            | 结果与保留证据                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Main candidate    | [30015803406](https://github.com/greatLiverheat605/Logion/actions/runs/30015803406) | 成功；不可变 Web/API/Worker/Backup 镜像、SBOM、provenance、许可证、digest/IaC/filesystem scan、smoke                                      |
| Full capacity     | [30015865113](https://github.com/greatLiverheat605/Logion/actions/runs/30015865113) | 成功；artifact `8567111678`、profile `github-hosted-reference-full`、精确基线/机器可读 percentile；`production_equivalent_approved=false` |
| Nightly assurance | [30015866638](https://github.com/greatLiverheat605/Logion/actions/runs/30015866638) | 成功；冻结依赖、Compose smoke、迁移、加密备份/空恢复、browser/PWA/WCAG 和安全产物                                                         |
| Release candidate | [30016463574](https://github.com/greatLiverheat605/Logion/actions/runs/30016463574) | 成功；artifact `8567480171`、`0.1.0-rc.phase6-final`、未变 Main 镜像、容量/恢复/兼容/浏览器/rollout rehearsal                             |

四个 run 均解析为 `a9b2f4ac2bc28e4dea89f041914e2d4376258f8d`。被替代的 Main/Capacity/RC/Nightly run 不是 Phase 6 完成证据。

## 不可变候选身份

| 项目           | 值                                                                        |
| -------------- | ------------------------------------------------------------------------- |
| Repository     | `greatLiverheat605/Logion`                                                |
| Source         | `a9b2f4ac2bc28e4dea89f041914e2d4376258f8d`                                |
| Migration head | `0034_sync_conflicts`                                                     |
| Offline schema | `4`                                                                       |
| Sync protocol  | `sync-v1`                                                                 |
| Web            | `sha256:ae061baacc557a33dafdea0945336942cbaa856b31398799205b24fa8d9abb23` |
| API            | `sha256:0f67bfae8348accf94664e3ea536d9eece8d6bae540843169674723ac545b05f` |
| Worker         | `sha256:aa2dde57ef0e1e535adebd836c44141626eb5723b6f20ea2f5fa8dd75d6000fb` |
| Backup         | `sha256:68dd1a376ef391b73f6daa47e78ff698b04f599a95d90aea993327db59d11b8c` |

安全产物显示四份 attestation、四个 image scan、filesystem scan 和 IaC scan 全部通过，生产依赖许可证无 denied package。RC 只拉取这些 digest 并执行 `up --no-build`，不重建候选。

## Phase 6 合并工作

| 能力                 | PR                                                                                                                                                                                                                                                     | 结果                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 不可变 Main/发布身份 | [#135](https://github.com/greatLiverheat605/Logion/pull/135)、[#139](https://github.com/greatLiverheat605/Logion/pull/139)                                                                                                                             | 四镜像 digest、manifest、SBOM/provenance、迁移 smoke、API p95                                |
| 候选供应链安全       | [#136](https://github.com/greatLiverheat605/Logion/pull/136)、[#141](https://github.com/greatLiverheat605/Logion/pull/141)、[#142](https://github.com/greatLiverheat605/Logion/pull/142)、[#143](https://github.com/greatLiverheat605/Logion/pull/143) | Web/基础镜像修复，attestation/image/filesystem/IaC 门禁，最小权限 Backup                     |
| RC/恢复/兼容         | [#145](https://github.com/greatLiverheat605/Logion/pull/145)–[#150](https://github.com/greatLiverheat605/Logion/pull/150)                                                                                                                              | 可信 run preflight、安全取产物、迁移 head、空恢复、epoch 更换、机器可读证据                  |
| 灰度策略             | [#152](https://github.com/greatLiverheat605/Logion/pull/152)                                                                                                                                                                                           | 5%→25%→100% 有序演练、候选绑定、失败关闭，不改 Production 流量                               |
| 原始 47 天模板       | [#155](https://github.com/greatLiverheat605/Logion/pull/155)                                                                                                                                                                                           | 可选版本包、provenance/license、preview-first Private 安装、新 ID、保留相对日期与验收        |
| 附件生命周期         | [#156](https://github.com/greatLiverheat605/Logion/pull/156)、[#159](https://github.com/greatLiverheat605/Logion/pull/159)                                                                                                                             | `init→upload→complete→verified`、MIME/size/SHA-256/租户/重放、离线队列、最小权限卷           |
| 完整参考容量         | [#157](https://github.com/greatLiverheat605/Logion/pull/157)                                                                                                                                                                                           | 可复现真实 schema 数据、硬件/生成器、query plan、饱和、p50/p95/p99                           |
| Yjs/持久冲突中心     | [#161](https://github.com/greatLiverheat605/Logion/pull/161)–[#164](https://github.com/greatLiverheat605/Logion/pull/164)                                                                                                                              | 增量 Yjs/可读快照、加密更新、hash-only 冲突、原子 Outbox/审计、真实 Sync Center 与双设备证据 |

高风险同步、附件、迁移、备份和发布变更均在合并前由 `diquizzer-ui` 独立审查；实现代理没有自我批准受保护变更。

## 质量与容量结果

最终容量产物生成并测量：100,000 Task、1,000,000 Event、25,000 Note + 25,000 Resource、10,000 Attachment 行/文件、5,000 Paper、100,000 AI run。六类查询各预热后测 30 次，p95 均低于 500 ms，最高为 GitHub-hosted reference runner 上 recent notes 的 4.510 ms。该结果仅为回归参考，不代表批准的 Production 硬件。

RC 浏览器报告：Chromium、Firefox、WebKit、移动 Chrome、移动 Safari 模拟共 54 个预期通过、6 个声明 skip、0 意外失败、0 flaky。离线兼容 4 suites 共 24/24。加密恢复演练用时 1,133 ms，RPO 样本 2 秒；head=`0034_sync_conflicts`，租户/附件数量与 SHA-256 匹配，epoch 已更换，旧客户端必须重新 Bootstrap 并隔离旧 Outbox。

## 第 9.2 节发布场景映射

| 场景                                       | 保留证据                                                                                    | 状态                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1. 双用户/跨 Workspace 拒绝                | Phase 1–5 集成矩阵及最终重跑                                                                | 自动通过                                            |
| 2. Viewer 邀请/实时撤销                    | invitation/membership 集成与浏览器路径                                                      | 自动通过                                            |
| 3. 通用计划→证据→验收→复习→日审查          | Phase 3 闭环与 Phase 4 memory/audit                                                         | 自动通过                                            |
| 4. 原始 47 天导入                          | `test_original_47_day_template_import_is_bounded_private_and_date_preserving` 及 UI/offline | 自动通过                                            |
| 5–6. 双设备离线笔记/状态/对象              | Yjs 双设备、加密重启、关键冲突、持久解决重放、附件                                          | 自动通过；物理手机待人工                            |
| 7. 丢失设备撤销                            | Identity/device 集成和残留提示                                                              | 自动通过                                            |
| 8. Paper/Question/Experiment/Metric/Export | Research/Portability 集成                                                                   | 自动通过                                            |
| 9. Provider fallback/确认/草稿隔离         | AI Provider/routing/run/draft 和 threat model                                               | 自动通过                                            |
| 10. SSRF/恶意 Markdown/附件/租户 ID        | Provider/attachment/content/sync/tenant 负向矩阵                                            | 自动通过                                            |
| 11. Backup/空恢复/旧设备                   | 最终 Nightly/RC `recovery-evidence.json`                                                    | 自动通过                                            |
| 12. 公共/认证/应用响应与无障碍             | 多浏览器、PWA/offline、自动 WCAG、键盘/viewport                                             | 自动通过；物理 iOS/Safari 和人工 screen reader 阻塞 |
| 13. Export 后账户删除                      | Portability/Deletion、可撤销 Share、retention 状态                                          | 自动通过；法务保留策略待人工                        |

## 综合安全审查

最终 `security-review` 覆盖 secret、有界输入/上传、参数化数据库、认证授权、XSS/CSP、CSRF、限速、错误/日志脱敏和依赖：

- Workspace/Space 授权由服务端解析；跨 Workspace conflict/attachment ID 失败关闭，其他 device 不能解决源设备冲突。
- 受保护 Note/Yjs/conflict 始终在 Vault 加密，entity/Outbox/conflict/audit/log 不含正文。
- Conflict 只存有界 hash/元数据，不复制明文；解决与 Outbox 原子，ACK 后才完成，重放幂等。
- Attachment 校验 filename/path、extension/MIME、检测内容、大小和 SHA-256；下载 private/no-store、`nosniff`、attachment disposition。
- 浏览器写入保留 auth/CSRF/limit；React 冲突预览只显示有界文本，不注入 HTML。
- 本地/CI 依赖无已知 high/critical；Main attestation/image/filesystem/IaC 全通过，license deny list 为空。

## 兼容与前向修复

`0034_sync_conflicts` 为增量迁移，已验证空库/最新升级和 PR 迁移往返。`note_document_update` 在 `sync-v1` 内增量增加，旧客户端继续读可读 Note snapshot。IndexedDB 保持 schema v4，受保护更新在 Vault 中，浏览器重启不丢 pending。恢复改变 `sync_epoch`，旧客户端必须重新 Bootstrap，恢复前 Outbox 被隔离。

不得将应用二进制回滚到无法理解的 schema/sync 语义。保留失败候选、停止晋级，以新 source commit 前向修复；新 commit 会使本文所有 run ID/产物失效，需重建 Main/Capacity/Nightly/RC 链。

## 剩余人工与运行阻塞项

下列事项不否定仓库自动化完成，但阻塞公开 Production，不能由合成 CI 代替：

1. 人类发布/无障碍负责人须在当前物理 Safari/iOS PWA 跑关键流程，并完成人工 screen-reader/keyboard 审查；截止任何 Production 批准前。
2. 基础设施负责人须选择云/区域，在独立账户或故障域配置不可变异地备份、真实告警、KMS/key escrow 和批准的生产等价容量。当前结果仍是 `production_equivalent_approved=false`。
3. 隐私/法务须批准条款、隐私声明、删除/备份保留、Shared Space 归属和数据驻留；截止公开注册或 Production 前。
4. 使用 5%→25%→100% 前，人类发布负责人须记录监控链接、on-call、观察窗口和人工 smoke。现有证据 `mode=rehearsal`，使用合成样本且不改流量。

[Issue #153](https://github.com/greatLiverheat605/Logion/issues/153) 保持开放，用于生产等价容量及其他运行证据。阻塞项关闭或两份根基线经人工明确修改前，禁止 Production。

## 人工阶段批准请求

人工批准可关闭 Phase 6 的仓库实现/发布加固阶段，并接受上述四项为硬 Production 阻塞；不得解释为生产部署批准。Production 另需批准并严格执行 `preflight → backup → compatible migration → 5% → observe → 25% → 100%`。
