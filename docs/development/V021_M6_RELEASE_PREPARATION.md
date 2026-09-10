# v0.2.1 M6 发布准备与门禁

> 更新：2026-09-10。PR #233、#234 已按批准合并；Main/capacity 已通过，Release 浏览器缺口已完成本地复验，草稿 PR #235 待最终远端检查与具体合并批准。尚未部署生产。
> [版本状态](V021_STATUS.md) · [执行计划](../../.codex/plans/current/2026-09-09_logion-m6-release.md) · [M5 结论](V021_M5_CLOSEOUT.md) · [完整准备历史](history/V021_M6_PREPARATION_LOG.md)。

## 已合并 main 候选

| 项目              | 身份                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| main 产品源码 SHA | `94c15f4a948c37081ea28fadd7010f2c30ba15e0`                                     |
| Git tree          | `b8232f03186d3bb2dda7de3364ab5327f7ee871a`                                     |
| 补丁审阅 head     | `0e856c3e439dfa9c32ad7bf148ac90bc687fbf00`，PR #234；合并 tree 一致            |
| 候选版本          | `0.2.1-rc1`；运行身份以完整 SHA/镜像 digest 为准，包元数据仍为 0.1.0           |
| 兼容性            | Alembic `0040_merge_gate2_heads`、sync-v1、offline schema 4；D-18 能力协商已验 |
| Git 状态          | PR #233/#234 已合并；原开发分支与补丁分支按保留要求恢复原 head                 |

## 同 SHA 制品门禁

仅把实际观察到的结果记为通过。Main 与 capacity 必须来自 main 且 head/source 与本页候选一致；Release 复用相同的四镜像 digest。

| 门                | 工作流/证据                                                                                              | 当前结果                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 前置           | [34425133343](https://github.com/greatLiverheat605/Logion/actions/runs/34425133343)，补丁 head `0e856c3` | fast/integration/browser 全通过；135 浏览器通过、10 既定跳过、零失败/flaky                                                                                       |
| 本机镜像          | 补丁三个最终镜像，Trivy 0.70.0，HIGH/CRITICAL + vuln,secret                                              | 构建、非 root、UUID、API live、worker 元数据、备份加解密/篡改拒绝通过；漏洞/秘密均零                                                                             |
| Main candidate    | [34442001304](https://github.com/greatLiverheat605/Logion/actions/runs/34442001304)                      | 成功且下载复核通过；源码/锁/合同/四 digest 一致，十项安全门、许可证、872 包 SBOM、200 请求 smoke 通过                                                            |
| Full capacity     | [34442112095](https://github.com/greatLiverheat605/Logion/actions/runs/34442112095)                      | 成功且下载摘要核验一致；数据量达标、六组查询通过，最慢 P95 5.984 ms；production_equivalent_approved=false                                                        |
| Release candidate | [34443058078](https://github.com/greatLiverheat605/Logion/actions/runs/34443058078)                      | 失败；完整认证浏览器发现三处缺口，下载摘要一致，修复与复验见 [sub-006](../../.codex/plans/current/2026-09-09_logion-m6-release/sub-006_release-browser-fixes.md) |
| 最终制品复核      | Main/Release manifest、合同和容量下载报告一致，证据仓库外保存                                            | Main、容量、恢复与 24 项离线兼容已核验；浏览器失败、灰度未运行，最终 Release 门未通过                                                                            |

容量目标：100000 tasks、1000000 events、25000 notes、25000 resources、10000 attachments、5000 papers、100000 AI runs。必须实际数等于预期、错误为空、六组查询通过；托管环境参考不等于生产等效批准。

Release 在 GitHub staging 隔离环境执行候选启动、空环境恢复、真实旧客户端兼容、浏览器/PWA/自动化 WCAG 和灰度政策演练。fixture 演练不代表真实生产流量或 ECS 恢复已通过。

## 固定镜像与下载制品

Main manifest 已在固定源码检出上运行仓库校验器，OpenAPI、两份锁文件、兼容性和四个镜像身份一致。

| 服务   | 镜像 digest                                                               |
| ------ | ------------------------------------------------------------------------- |
| api    | `sha256:bb75f3b1174e5385651d446b202e6729c39759a70739c1fcb4261cfbde79cda2` |
| web    | `sha256:33f1463a0b4f1b3d17f2f3d6b15954524b2a97209519d1d097f33af7a46e4bd3` |
| worker | `sha256:0305d695c4b654b348f8be0bca2ede7d0bb2adf6ab2202ba5dd1234cf266a0f6` |
| backup | `sha256:31146c169eda11ec8a96c5e45316cbb7c81e799d55dddd39cb13a510539911db` |

| Main 制品 | Artifact ID | ZIP SHA-256                                                        |
| --------- | ----------- | ------------------------------------------------------------------ |
| 候选证据  | 10138453665 | `589108d2af66e301ca2ba7cd2653f3d12435f1ee53d407939df51625a1808a00` |
| 安全报告  | 10138450784 | `396023df06c5f69def791b7c6c920df21e75721e4805f8821059795ae089c2fd` |
| SPDX SBOM | 10138453078 | `6e7f73014d8479be93ea29ff9e33d440c5388e41cbf7107c11c443f72d63c0d2` |

容量 artifact 10138332830 的 ZIP SHA-256 为 `378708f87c27bebb3f91fc81a65984f70efda752b77678f6cfdf3f0ff3d27a69`。原下载文件、解包报告和逐文件摘要在仓库外保存；报告仅记录公开制品身份。

## 已处置的前次失败

- 原 main `c5795c6` 的 Main `34423144515` 因 API/worker/backup 的七项 libuuid HIGH 和 Web attestation 查询 HTTP 502 失败。失败制品已校验保留。
- PR #234 提高 libuuid 下限至 `2.42.3-r1`；不忽略 CVE、不降低扫描阈值、不跳过 provenance。
- 原容量 `34423286425` 虽成功，只归原 `c5795c6`，不能作为当前候选通过依据。
- 本机镜像源连接失败、apk 版本辅助查询错误与 Run 扫描预算诊断均保留，修正辅助操作后复核通过；不当作产品成功或掩盖失败。

## 生产发布条件

| 阶段       | 必需结果与停止线                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 只读预检   | 核对实际 ECS 源码、四个运行 digest、schema、卷、密钥权限、Owner 数、TLS/CSP、配置合规及资源；仅记录脱敏身份与结论 |
| 回滚身份   | 保存旧四镜像与旧 manifest；缺摘要或无法保留旧制品则停止                                                           |
| 维护与备份 | 明确环境/窗口并获得停写批准；停止写入者，用现有密钥生成加密备份、校验并同步受控异机；保留数据卷和密钥             |
| 独立恢复   | 使用指定生产备份恢复独立空环境，核对租户/成员/附件/审计/sync_epoch 及认证/同步；M5 事故恢复不替代此门             |
| 切换与迁移 | 对具体四 digest、实际 schema 和回滚方案取得批准；健康或身份不符立即停止，非空破坏性 downgrade 禁止                |
| 外部 smoke | 当前生产候选的邮件、同步、认证及必要 Provider 验证；明确批次和额度后执行                                          |
| 观察与完成 | 至少 24 小时观察 5xx/OOM/重启/积压、资源、备份/告警、邮件和同步，再取得生产完成判定                               |

操作依据：[生产发布手册](../../infra/runbooks/aliyun-production-release.md)、[备份恢复手册](../../infra/runbooks/backup-restore.md)。D-06/D-17 延后和豁免继续有效，不自动恢复移动施工或真实读屏。

## 授权和保留

已授权：PR #234 合并、同 SHA Main/capacity/Release 制品验收、确定性缺口修复及提交/推送/草稿 PR、Markdown 文档梳理。PR #234 的批准已执行；PR #235 的新增差异须具体 main 合并批准。生产停写、备份、迁移、重启、切换、权限/网络或敏感开关尚无本批具体批准。

M5 原 Provider 六次、邮件十封额度均耗尽；本批新增均零。生产私有配置、凭据、收件地址及备份位置只在受控仓库外保存。原主树和 T-04 保护、用户持久化服务及数据保留，当前计划不自动归档，正式独立 review 不补造 accepted。

## 当前 Release 失败（2026-09-10）

Artifact 10138952000 的 ZIP SHA-256 为 `7a3de8773acd95fed2d38b2127418d66ad5396c5ea90dc0f8f611dfb3faa18ed`，已核验保存。完整浏览器 246 passed、3 failed、14 skipped、4 未运行，零 flaky；修复基线为本页固定候选，灰度演练未运行。Main 成功不代表 Release 成功，先完成 sub-006，再固定新源码与同 SHA 制品。

恢复报告绑定同 SHA 与固定 backup digest，schema 一致且 sync_epoch 已更换，RTO 为 1037 ms；其 fixture 结果不等同实际 ECS 恢复。通用报告列出的真机/读屏人工项按当前 D-06/D-17 决策处理，未重新要求实际读屏。

## 修复候选复验进展

[草稿 PR #235](https://github.com/greatLiverheat605/Logion/pull/235)修复附件上传/重试选错行、深色选中标签对比度，并精确定位画像提示、笔记和导出任务；模板安装先完成真实近期登录。十文件代码提交为 `2cefbcf237a8f0cbb9e089b9f4b73c803fe0b27a`，基线为本页 main；25 份 Markdown 整理另行提交。

本地完整 CI 通过：Web 433、offline 75、Python 614。最终聚焦 7 passed；完整浏览器 254 passed、14 既定 skipped、零 failed/flaky，合计 268，启用 --fail-on-flaky-tests。明暗主题均覆盖 21 路由 WCAG；没有放宽权限、API、同步合同或无障碍标准。

本文提交时，最终文档提交后的远端 fast/integration/browser 尚待完成；实际最终 head、run 与复核制品摘要在 PR 和本地追加记录中固定。旧代码 head 绿灯不替代最终 head。新 PR 尚未合并，新 main 的 Main/capacity/Release 仍待执行。本页上方 `94c15f4` 的镜像和成功门只属于旧候选。

local-7 lint、local-8 代理断连和登录清理/旧导出行导致的 flaky 均保留；修正前 exit 0 不计为零 flaky 通过。完整根因与前提见 [sub-006](../../.codex/plans/current/2026-09-09_logion-m6-release/sub-006_release-browser-fixes.md)。
