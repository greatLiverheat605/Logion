# v0.2.1 当前状态

> 更新：2026-09-10。M5 按批准范围完成；M6 正在验收发布制品，尚未部署生产。
> 阅读入口：[开发文档导航](README.md)。实际制品状态集中维护于 [M6 发布准备](V021_M6_RELEASE_PREPARATION.md)。

## 已完成

- 本版修复范围包含 T-00–T-03、T-05/T-05a/T-06，以及 M5 发现的 UI、权限、Provider TLS、邮件链接、导航、学习状态和同步恢复缺口。
- M5：50 passed、0 failed、2 partial、0 blocked、6 out_of_scope、0 not_run，合计 58。两个 partial 按批准决定延后；真实读屏明确豁免。[完整结论](V021_M5_CLOSEOUT.md)。
- D-18 完成旧端删除能力协商：普通同步可用；不能安全处理的删除暂停且保留内容；新端从原队列、游标恢复。
- PR #233 与安全补丁 PR #234 已获批准并合并。当前 main 产品候选为 `94c15f4a948c37081ea28fadd7010f2c30ba15e0`，tree 为 `b8232f03186d3bb2dda7de3364ab5327f7ee871a`。
- PR #234 仅三个 Dockerfile 各一行；本机三个镜像运行和安全扫描通过，同 head fast/integration/browser 通过，浏览器 135 passed、10 既定 skipped、零失败或 flaky。

## 正在执行

1. [草稿 PR #235](https://github.com/greatLiverheat605/Logion/pull/235)完成十文件修复，代码提交 2cefbcf；本地完整 CI 与浏览器通过（254 passed、14 既定 skipped、零失败/flaky）。文档提交后的最终 head 远端检查与具体 main 合并批准仍待完成，见 [M6 门禁表](V021_M6_RELEASE_PREPARATION.md#同-sha-制品门禁)。
2. 25 份 Markdown 的导航、范围、结论和五份完整历史快照已重组；文档独立提交，不更改旧 M5 计数、失败或豁免。最终远端结果在 PR 与本地追加记录中绑定实际 head/run。
3. 成功的同 SHA Release 制品仍是生产预检、恢复点、维护窗口与回滚方案的前置；生产尚未部署。

## 边界与后续

- M5 完成不等于生产发布。ECS 当前仍按旧版本处理，尚未实测本候选的生产部署或至少 24 小时观察。
- D-15 仅允许 AppShell 画像入口五行 aria-label 删除；其余 T-04 本地修改继续保护。
- D-16：完整邀请 URL/复制延后；D-06：移动侧栏/真机施工延后；D-17：不再要求真实读屏，不冒充实测通过。
- M5 累计 Provider 六次、邮件十封已达原批准上限。本轮新增均零；M6 实际外部批次按环境和额度另行明确。
- 原主树历史基线和用户持久化数据保留；独立候选用于 Git 与制品验收，文档整理不改变固定产品源码。
- 后续 O/N/U 提议、私网 Provider、敏感能力启用不属于本次批准范围。正式独立 review task 仍 pending，不补造接受记录。

## 依据

[交付范围](V021_DELIVERY_SCOPE.md) · [FABLE 总表](FABLE_PLAN_REGISTER.md) · [M5 结论](V021_M5_CLOSEOUT.md) · [M6 计划](../../.codex/plans/current/2026-09-09_logion-m6-release.md) · [历史索引](README.md#验收与历史依据)。
