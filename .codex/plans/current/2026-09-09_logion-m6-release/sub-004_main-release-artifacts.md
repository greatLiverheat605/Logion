# M6 main 合并与同 SHA 制品验收

- 父计划：[M6 发布计划](../2026-09-09_logion-m6-release.md)，步骤 2 的直接子计划。
- 状态：执行中；PR #233/#234 已合并，main 固定 94c15f4。Main/capacity 成功，Release 34443058078 的完整认证浏览器门失败，sub-006 正在独立修复；Markdown 结构整理已完成，继续同步实际状态。生产未部署。
- 历史 PR #233 批准候选：`1e1c6fd46d72af6054702a270fd07e671c0b7525`，tree `f571ecfd38b6ca38c2441fb06ed40805abff452e`。
- 历史 PR #233 合并前 main：`37e2e005d5594da31daade87d67a4ea183283b06`；PR 15 提交/175 文件及四项检查通过。
- 单一写入：独立交付副本、已批准 PR/工作流、本地主树的本次状态文档与 Run；原主树代码和暂存区保持。

## 执行步骤

1. 记录授权并复核候选/远端/保护/Run；将 PR 转为可合并状态，按仓库允许方式合并，记录真实 main SHA 并核对 tree。
2. 等待该 main SHA 自动触发的 Main candidate；在 main 调度相同 source_sha 的 Full capacity profile，使用默认 github-hosted-reference 标签。
3. 两工作流成功且 head/ref/source 一致后，调度 Release candidate，版本标识 `0.2.1-rc1`，绑定真实 source_sha 和两项成功 run ID。
4. 核对四镜像 manifest、digest、合同/锁文件、provenance、SBOM、安全/许可证、smoke、容量、旧端兼容、隔离恢复与浏览器证据；保存仓库外摘要，更新发布状态。

## 边界与停止线

- 不放宽现有工作流检查、不以旧 SHA 结果替代；失败保留原始证据，确定性缺陷在批准范围内修复后重新固定候选并检查。
- capacity 的 production_equivalent_approved 保持 false；Release 为 GitHub 隔离环境验收，不冒充 ECS 生产恢复或部署。
- 原用户服务、T-04 修改、未解释工作树修改及数据保留；不删除源分支或用户数据。
- 本轮 Provider/邮件新增额度为零；生产维护、备份、迁移、切换与实际外呼需绑定环境/窗口另获批准。
- 技术验收后留 current，不自动归档或补造独立 reviewer accepted。

## 执行记录

2026-09-10：用户批准已记录，合并前身份与四项检查核对一致，Run 校验通过。开始具体合并和制品门。

2026-09-10：PR #233 已按仓库支持的 squash 方式合并，实际 main SHA 为
`c5795c6aa70f5c17e26437958ddf31ca200ab04f`；tree 与已验收 `1e1c6fd` 完全一致。
Main candidate run `34423144515` 已自动启动，Full capacity profile run `34423286425`
已在 main 调度并绑定相同 source_sha，profile 保持 github-hosted-reference。
独立合并检出与原候选 clean，原主树基线、空暂存区及 T-04 摘要保持；两个工作流
仍在执行中。待两项成功后，使用其真实 run ID 继续 Release candidate。

2026-09-10：同 main SHA 的 Full capacity profile run `34423286425` 成功，制品
`10131716107` 下载摘要与 GitHub 一致；实际 100000 tasks、1000000 events、
25000 notes、25000 resources、10000 attachments、5000 papers、100000 AI runs
全部达到预期。六组查询均 passed，最慢 notes_recent P95 为 6.32 ms；
production_equivalent_approved=false 保持。容量复核脚本首次误把 queries 对象按
列表读取，纠正解析后通过；原制品字节和验收条件未变。Main 候选镜像检查继续运行。

2026-09-10：Main run `34423144515` 最终失败；完整 CI、四镜像构建、provenance
生成及运行 smoke 已通过，安全门被 API/worker/backup 的 libuuid 七项 HIGH 和
Web attestation 查询 HTTP 502 阻断。失败制品 `10131872201` 的下载摘要已核对。
完整容量 run `34423286425` 已通过，但 Release 尚未调度。独立 main 修复分支仅
在三个 Dockerfile 增加 `libuuid>=2.42.3-r1`，沿用原系统包下限策略，未放宽扫描。
本机首次构建因 Docker Hub 连接超时失败，未执行到补丁安装；日志保留，正在通过
相同摘要的官方基础镜像完成本地构建及安全复核，补丁尚未提交或合并。

2026-09-10：最小运行库补丁已提交为 `0e856c3e439dfa9c32ad7bf148ac90bc687fbf00`，
草稿 PR #234，三个 Dockerfile 各改一行；同 SHA PR run `34425133343` 的 fast 和
integration 已成功，browser 仍在收取结果。本机 backup 构建、非 root、UUID、
加解密往返和篡改拒绝通过，Trivy HIGH/CRITICAL 漏洞与秘密均零；首次版本复核脚本
误用 apk info 输出，改读实际包数据库后通过，首次失败保留。API/worker 剩余下载继续。
合并后复核发现远端原开发分支被删除，已用仅允许不存在引用的保护推送恢复至原
`1e1c6fd`；原候选、主树和用户数据保持，未改生产。PR #233 正文已同步实际合并和
安全阻断状态。本次安全补丁仍待最终验收及具体 main 合并批准。

2026-09-10：PR #234 固定 head `0e856c3e439dfa9c32ad7bf148ac90bc687fbf00` 的
技术验收完成。相对 main `c5795c6` 仅三个 Dockerfile 各一行，最终 tree 为
`b8232f03186d3bb2dda7de3364ab5327f7ee871a`。三个最终镜像构建、非 root、UUID、
API live、worker 导入/健康元数据、备份加解密与篡改拒绝通过；Trivy 0.70.0 使用
HIGH/CRITICAL 与 vuln,secret 扫描，三镜像漏洞和秘密均零。工具官方 checksum 已核验。
同 head PR run `34425133343` 的 fast/integration/browser 全部 success；浏览器
135 passed、10 既定 skipped、零 failed/flaky，许可证政策 passed。下载制品
`10132452600` 和 `10132442200` 的 SHA-256 均与 GitHub 一致。仓库外最终复核
`m6-runtime-final-review.json` 绑定镜像、扫描摘要与完整 Git 身份；原候选 clean、
原主树基线/空暂存区/T-04 保护核验通过，当前 Run 和文档格式检查通过。

PR #234 保持草稿等待该新补丁的具体 main 合并批准；此前批准的 PR #233 已完成。
批准后必须固定新 main SHA 并重跑 Main/capacity/Release，原安全失败和容量成功
保留为历史证据。M5 按批准范围完成；M6 尚未取得成功的最终发布制品，生产停写、
备份、迁移、部署与至少 24 小时观察均未执行；新增 Provider/邮件均零。

2026-09-10：所有者批准 PR #234（`0e856c3`）合并并继续新 main 同 SHA 的
Main/capacity/Release 验收，同时要求重新梳理 Markdown 文档。合并前重新核对
三行差异、同 SHA 三项 PR 检查和原工作树保护；新增直接子计划 sub-005，集中
梳理当前状态、历史依据、执行入口和生产条件，原始失败及批准记录继续保留。

2026-09-10：PR #234 已 squash 合并为 `94c15f4a948c37081ea28fadd7010f2c30ba15e0`，
Git tree `b8232f03186d3bb2dda7de3364ab5327f7ee871a` 与获批补丁一致。Main run
`34442001304` 自动运行，capacity run `34442112095` 已按相同 source_sha 和 main
引用调度，保持 github-hosted-reference。新增独立固定 main 检出；原补丁候选 clean。
GitHub 再次删除补丁源分支，按保留约束恢复原 head；没有更改仓库自动删除设置。
当前门禁仍在运行。文档按统一当前状态入口和可追溯历史重新组织，生产及新增外呼未执行。

2026-09-10：步骤 1 已完成；新 main 的 Main 34442001304、capacity 34442112095 均成功且身份一致。容量已下载复核通过。步骤 3 已调度 Release 34443058078；步骤 4 制品核验执行中。旧记录仅对应其注明候选，不代替本次门禁。

2026-09-10：Release 34443058078 在完整认证浏览器门失败，246 passed、3 failed、14 skipped、4 未运行，零 flaky；原件摘要核对一致。新增直接子计划 sub-006，修复深色标签对比度、画像提示定位和设备清除测试的笔记身份。候选启动/恢复/旧端兼容已过，灰度演练未运行。原候选、主树和数据保持。
