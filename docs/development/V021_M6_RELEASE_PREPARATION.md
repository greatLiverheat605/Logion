# v0.2.1 M6 发布准备

> 日期：2026-09-09。状态：草稿 PR #233 已创建，首轮快速检查失败后修复中；M5 按批准范围通过。删除语义的旧客户端兼容门尚未关闭，合并及生产切换未批准。
> 执行入口：[M6 计划](../../.codex/plans/current/2026-09-09_logion-m6-release.md)。验收依据：[M5 最终记录](./V021_M5_CLOSEOUT.md)。

## 固定输入与实际核验

- M5 历史基线：`bac2a4371ce6a12d6c3e9a6124104d121b0f8807`；已推送 PR 初始 head：`3fc558d92b593b8b6895a338e2e4ee1424cb767d`。
- 远端 main：`37e2e005d5594da31daade87d67a4ea183283b06`，是基线祖先；开发基线领先九个提交。
- R-14 二十三产品摘要：`84e7adfa5f2c0b33ae1bf9b34d31082d381e53c2fca4558f197511cbe35b11fc`。
- 五十三源码测试摘要：`062f080c5d4ea894cac0c95a934545fc133a58f77fff260d0b1230b3e74d5c60`。
- 兼容性身份：Alembic `0040_merge_gate2_heads`、`sync-v1`、offline schema 4；远端 main 的 offline schema 同为 4。协议名称与存储版本相同不代表 wire 相同：既有 T-05 增加删除预检与三个 Push 响应可选字段。旧客户端删除兼容门未通过，见下文；生产实际 schema 和回滚仍未验证。
- 主树存在其他未提交修改。交付只取 M5 已验证选择和本轮准备文档；AppShell 从固定候选取基线加 D-15 五行删除，其他 T-04 改动、历史 T-04 报告和未解释目录不进入交付包。

远端公开 API 只读核验：

| 工作流                | 最新成功 run | 对应 SHA                                   | 对本轮含义         |
| --------------------- | ------------ | ------------------------------------------ | ------------------ |
| Main candidate        | 33742123578  | `37e2e005d5594da31daade87d67a4ea183283b06` | 旧 main 的制品证据 |
| Full capacity profile | 33735531223  | `91a02697e193c712c4e0aac7f9f4024daed93fe3` | 旧容量证据         |
| Release candidate     | 33740072308  | `5d99d8118b32a219c83951d0d232c88bc7ecbc2e` | 旧 RC 证据         |

本机 GitHub CLI 未登录，公开 API 已可读取运行状态；不能据此宣称具备创建 PR 或调度工作流的认证。Git 远端读取正常。九个既有提交相对 main 涉及 113 文件，未来 PR 必须包含它们及 M5 新修复的完整差异；不能只展示新修复片段。

## 初始本地交付包与检查结果（历史）

独立 Git 副本基于上述完整 M5 基线，只暂存 72 个文件：53 份 R-14 源码测试及 19 份文档。产品与测试字节、主树 T-04 保护摘要和空暂存区均已核对。连同九个既有提交，面向 main 的完整差异为 160 个文件；已保存两组 patch、差异统计、逐文件摘要和精确 Git tree。

仓库外的 `prepared-tree.json` 是提交前的文件树清单，`candidateCommit` 仍为 null，不是发布制品 manifest。最终树以该清单及 `delivery-check-final.json` 为准；文档收口后重新同步和核验，避免将旧文档摘要当作最终结果。

已实际通过：

- 发布工具测试 21 passed：candidate manifest、workflow、安全校验、rollout gate 和加密备份工具；JUnit 已保存。
- 72 文件的选择、暂存字节、R-14 摘要、保护边界和 Git 空白检查。
- 19 份文档的 133 个本地链接、所选文件的 Prettier 格式及秘密扫描。
- 当前 Run 校验；旧角色正式 review 仍 pending，不补造任务接受记录。

产品未变，M5 完整 CI 八门及 Web 430/Python 612 passed 证据继续绑定 R-14，不重复执行。上述本地工具测试不代表远端 CI、真实镜像、生产备份或独立恢复已经通过。本轮新增 Provider 请求、邮件、Git 提交及生产变更均为零。

## 交付与制品顺序

1. 在独立本地副本准备准确候选、暂存选择、基线差异及 main 差异，保留主树原文件和暂存区。
2. 获准后创建候选提交并推送现有开发分支，建立面向 main 的草稿 PR；提交消息建议为 `fix: close M5 UI and provider acceptance gaps`。不从该批准推导合并或部署。
3. 完成 PR 检查和完整差异复核，取得具体合并授权。合并后固定实际 main SHA，不能把合并前 SHA 当作发布身份。
4. 在该 main SHA 运行 Main candidate 和 Full capacity profile；保持工作流 ref 与 source_sha 一致，等待实际成功，再执行 Release candidate 门禁。
5. 复用 `candidate_manifest.py` 验证四镜像 digest、source commit、合同/锁文件摘要及兼容性；核对 provenance、SBOM、安全/许可证报告、镜像 smoke 和独立恢复证据。没有真实 digest 不生成冒充有效的 manifest。

现有 `.github/workflows/release.yml` 要求 Main 与 capacity 的成功 run 都来自 main 且 head SHA 等于输入 source SHA；本轮不放宽它。发布标签建议 `0.2.1-rc1`，实际制品生成时再绑定最终 SHA。项目包元数据当前仍为 0.1.0，运行身份以经验证的候选 SHA 为准，不在准备阶段擅自批量改包版本。

## 生产预检、备份与切换

| 阶段       | 核验与停止线                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只读预检   | 记录现有源码、四个运行镜像/RepoDigests、Alembic head、数据卷、密钥文件存在/权限、Owner 数量、TLS/CSP、配置合规布尔值及资源；禁止输出 Env、密钥或用户内容 |
| 回滚身份   | 保存旧四镜像实际身份与旧 manifest，缺任一摘要或无法保留旧制品则停止；不使用浮动 tag 猜测旧镜像                                                           |
| 维护与备份 | 获得具体维护窗口和停写批准后，停止应用写入者；使用现有密钥生成加密备份并校验、同步受控异机，保留所有数据卷和旧密钥                                       |
| 独立恢复   | 用指定加密备份恢复独立空环境，比对租户/成员/附件/审计及 sync_epoch，执行认证/同步 smoke；M5 事故恢复不能替代此门                                         |
| 候选切换   | 用验证后的四 digest 替换应用，按实际 schema 兼容性迁移；健康或身份不符即停止，不启动无法读取新 schema 的旧镜像                                           |
| 观察       | 先以 prerelease 运行，记录邮件/同步/认证、容量、5xx/OOM/重启/积压、备份与告警，至少 24 小时后再判定生产完成                                              |

复用[发布手册](../../infra/runbooks/aliyun-production-release.md)及[恢复手册](../../infra/runbooks/backup-restore.md)。旧手册的 rc2 名称及原真机要求按当前候选与 D-06/D-17 范围决定解释，不自动恢复已延后的移动施工或真实读屏。新版本生产邮件、真实同步和浏览器 smoke 仍须执行；M5 累计六次 Provider 请求及十封邮件额度已耗尽，M6 的具体外呼和收件批次另行列明后授权。

备份、停写、迁移、重启、权限/网络变更和敏感开关未获本轮具体批准。当前生产事实仅沿用明确标注的历史只读观察，不假称已经重新检查 ECS。Windows 异机备份位置和生产私有配置只在受控仓库外记录。

## 当前可审批动作

所有者在具体交付提案后要求开始 M6，已批准提交、推送 `dev/T-06-status-copy-consistency` 并创建面向 main 的草稿 PR。项目[交付合同](./AGENT_DELIVERY_WORKFLOW.md)要求的该次 Git 授权已取得，无需重复询问。下一道决策是完成 PR 检查和完整差异复核后的具体合并；生产切换在制品、备份/回滚和窗口明确后单独批准。

## 获准执行记录

2026-09-09：原批准的 72 文件树已原样提交为 `3620176704c27ecdef481aedee7fd62823f0718c`，Git tree 仍为 `2bf704726254258a85760834a95d953f60cdbb9c`。产品与测试摘要和 R-14 一致；原主树仍位于历史基线、暂存区为空，T-04 保护修改保留。

本次授权与执行进度通过单独文档提交跟随产品提交，新增一份 Git 交付子计划。因此交付总选择为 73 文件，完整 main 差异为 161 文件；新增范围仅为必要计划记录，产品范围不扩张。推送和 PR 的真实结果以后续观察为准，不提前填写成功。

本页不是部署执行结果：实际合并 SHA、同 SHA 远端制品、生产预检、恢复演练、维护切换、M6 外呼/邮件、24 小时观察均未完成，不记 passed。

## PR 检查与兼容性复核

已推送初始 head 并创建[草稿 PR #233](https://github.com/greatLiverheat605/Logion/pull/233)，
面向上述 main 包含 11 提交、161 文件。首轮
[PR checks](https://github.com/greatLiverheat605/Logion/actions/runs/34347403413)
中 integration 与 browser 成功，fast 在 JavaScript 依赖审计失败；
[Mobile builds](https://github.com/greatLiverheat605/Logion/actions/runs/34347402398) 成功。
完整提交历史秘密扫描零发现。初次导出完整差异曾超过辅助脚本缓冲区，已以流式输出
补齐并核对提交与远端；失败证据保留，不归为产品失败。

本地复现 6 项依赖漏洞后，更新 Next.js/eslint-config-next 至 16.3.3、sharp 至
0.35.4、js-yaml 至 4.3.2、Vitest 配套至 4.1.11。锁文件仅包含对应依赖闭包更新
和 peer 解析变化；安装成功，复查审计为零漏洞。Python 审计无已知漏洞，两项本地
workspace 包不在 PyPI，按审计工具跳过提示保留。

普通冲突的 `remote_deleted_at: null` 会被 main 旧版严格校验器拒绝。
字段级省略空值修复后，Push 序列化 9 项通过；旧版校验器实测普通冲突由拒绝转为接受，
真正删除冲突的非空字段仍被拒绝。回归修复前 1 failed / 1 passed 的证据保留。
本次产品与依赖已改变，R-14 只作 M5 历史证据，新候选必须重跑完整检查。

删除结果的 `impact`、拒绝的 `details` 以及非空 `remote_deleted_at` 均超出旧校验器，
不能声明任意旧客户端与新服务端混用通过。Release 工作流现有“Old-client”步骤
实际运行当前 checkout 的 offline 测试，并未加载旧 main 校验器，不能替代跨版本实证。
具体兼容方案与验收在[兼容性子计划](../../.codex/plans/current/2026-09-09_logion-m6-release/sub-003_old-client-compatibility.md)中列明；
该决策关闭前 PR 保持草稿，不提出直接合并或生产发布。

本次修复的完整 `pnpm ci:fast` 实际退出 0，包含 Web 430、Python 614 passed /
120 deselected、类型检查、构建及合同生成；没有生成合同差异。Next 新 lint 规则产生
4 条既有整页导航警告，零 lint 错误；认证/账号切换的整页重载未因升级而改动。
这些结果绑定当前六文件修复，后续文档检查单独执行；新提交的远端 CI 仍待观察。
