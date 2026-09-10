# v0.2.1 M5 本地回归记录

> 历史适用范围：本文记录 2026-09-07 的候选与检查，以下“未通过”“未提交”和过程计数均为当时状态。M5 最终按批准范围完成（50 passed、2 partial、6 out_of_scope），见 [M5 结论](V021_M5_CLOSEOUT.md)；当前 Git 与发布进度见 [v0.2.1 状态](V021_STATUS.md)。

> 日期：2026-09-07。状态：首轮执行与结果归纳完成，以下保留修复前历史，M5 验收门未通过。
> 产品候选：`bac2a4371ce6a12d6c3e9a6124104d121b0f8807`。
> 后续 R-01–R-03 已修复并复验，当时 43/1/5/3/6 结果见 [修复报告](./V021_M5_FIXES_REVIEW.md)与 [清单](./FABLE_REGRESSION_CHECKLIST.md)。
> 入口：[计划总表](./FABLE_PLAN_REGISTER.md)、[58 项清单](./FABLE_REGRESSION_CHECKLIST.md)、[生效范围](./V021_DELIVERY_SCOPE.md#生效范围2026-09-07)。

## 结论与范围

58 个原 ID 全部保留：40 passed、3 failed、6 partial、3 blocked、6 out_of_scope、0 not_run。
passed 仅表示表内注明的本地验收意图通过；部分界面错误分支使用明确 mock，不能解释为真实外呼通过。
原 27 项通过基线中，12.2 按 D-06 延后；其余 26 项为 24 passed、6.2 failed、12.1 partial，
尚未满足零回归门。不能因为本地通过总数高于旧报告，就宣称版本验收通过。

所有者在具体推荐稿后回复“开始”，本轮采用 D-02/D-03/D-06：归为 v0.2.1 修复候选，
保留 T-00–T-03、T-05/T-05a/T-06，继续延后 T-04/T-07、移动真机和未批准的 O/N/U 演进。
本轮只调整两份浏览器测试并更新文档，没有改产品源码、提交、推送、合并或部署。

主要缺口是重复作答阶段残留、互操作中心导出文案、成功 Toast 对比度，以及侧栏画像入口的
可访问名称不匹配。未观察到可确认为新增 P0/P1 的证据；以下问题建议按 P2 跟踪，其中 R-01
已是旧报告的待办、R-02 属原 T-06/P2。未运行的生产、真实读屏、邮件和完整跨账号安全检查，
不由此获得通过结论。

## 环境与归因

- 对完整候选 SHA 执行 Git archive 后建立隔离 production build，产品源码无覆盖。
  受保护的 T-04 工作树改动未进入候选；两份测试调整仅影响执行脚本。
- 使用独立本地数据库、独占 Redis 逻辑库、API、Worker 和 Web；API/Web health 均返回完整候选 SHA。
  邮件为 disabled，未启用敏感能力、未调用真实 Provider、未使用生产数据。
- Playwright 1.61.1，Chromium 149.0.7827.55，Linux/WSL。业务测试包含 1440、1024、390、375、320px
  的相关仿真路径；不等于移动真机或软键盘验收。
- Lighthouse 13.0.1 采用独立认证浏览器、desktop preset、空合成账号、锁定 Vault。
  Today 98、Planning 100、Records 98、Review 100、Sync 100、AI 99、Workspaces 100、Data 100。
  此分数对应页面静态状态，不覆盖显示 Toast、打开弹窗后的所有状态。
- 为增加合成账号容量，曾仅将隔离 API 注册额度从 5 调为 100；结束后恢复为 5。
  原始 429、API 重启时的一次 500 均属测试初始化记录，没有计入业务通过数。

## 证据索引

本机证据组为 `fable-m5-zTUK9x`，原始结果、截图和脚本保留在仓库外。下表目录内的
`results.json` 为 Playwright 实际结果。各轮有重跑及用例重叠，不累加为产品通过率。

| ID  | 证据目录或日志                          | 实际结果及用途                                                                                                |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| E01 | `existing-1788761231557`                | 9 个原 spec，29 passed / 5 failed / 4 did not run；Today、Planning、Records、反馈、状态文案等                 |
| E02 | `auth-provider-1788761768258`           | 3 passed；真实登录/退出/会话撤销、Provider 配置/预算；发现矩阵全部 mock                                       |
| E03 | `core-conflict-1788762445257`           | 1 passed；Goal/阶段、四种会话终态、离线 Note、幂等、独立设备 bootstrap、真实冲突解决                          |
| E04 | `workspace-1788762236876`               | 1 passed；成员 UI/API、邀请接受、同会话角色 200→403→200、撤权 404；邀请仍是 token                             |
| E05 | `supplemental-final-1788762835060`      | 3 passed / 1 failed；真实关闭态附件、两次 Mastery 确认、真实日程；重复 Quiz 阶段失败                          |
| E06 | `existing-rerun-1788762589223`          | 5 passed / 1 failed；互操作全部通过；Review 越界检查通过后在 Toast axe 对比度失败                             |
| E07 | `sync-isolated-1788761495921`           | 1 passed；原 T-05a spec 独立账号通过，非空 Vault/实体/Outbox 保留                                             |
| E08 | `mastery-isolated-1788762914987`        | 2 passed；原 Mastery 理由 spec 独立账号，1440/320px 的有值与空值显示                                          |
| E09 | `feedback-final-1788763108782`          | 3 passed / 1 failed；Sync 真实成功、mock 503 后恢复、真实附件关闭原因及控制台通过；预算断言误用未知码，见 E10 |
| E10 | `budget-final-1788763203337`            | 1 passed；预算真实保存/重载回读、mock 503 的中性错误和请求编号、真实旧预算未改                                |
| E11 | `lighthouse-1788762713031/summary.json` | 8 页最低 98；完整报告另记录 R-04、Today skip-link 与部分 heading-order                                        |
| E12 | `targeted-unit-direct.log`              | 3 文件 / 34 passed：导出控制器 14、导出页面 10、Review 页面 10                                                |
| E13 | `task-evidence-1788763493323`           | 1 passed；Task planned→in_progress→submitted→verified→done，唯一 Evidence 关联/持久化，匿名 bootstrap 401     |
| E14 | `cleanup.json`                          | 18 个合成账号及关联数据清理，91 张业务表总行数 0，Redis 键 0，临时认证 profile 删除                           |

执行入口是隔离候选的 `@playwright/test/cli.js test`，指定 `authenticated-chromium`、单 worker、
trace off；每轮由临时启动器创建新合成账号。E03–E05、E09/E10、E13 的补验脚本以 `m5-` 命名，
未入仓库。E12 使用候选 Web 目录内 `node node_modules/vitest/vitest.mjs run`，指定三份测试文件。
最初通过 pnpm 在 archive 目录启动单测触发依赖状态检查并中止，随后直接使用已安装 Vitest 成功，
未批准或执行清空共享 node_modules。

此前同一产品 SHA 的完整 `pnpm ci:fast` 结果见交付范围：Web 403、offline 74、contracts 13、
mobile 4、Python 606 passed / 109 deselected、协调测试 118、mypy 181 文件。本轮没有把旧计数
当作新执行，也没有重跑完整 CI；新增证据是上表浏览器、Lighthouse 和 34 项定向单测。

## 已确认问题

| ID   | 现象与最小证据                                                                                                                           | 影响与下一步                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R-01 | E05：真实 self_assessed 题离线保存后显示“最近尚未判定”；第二次打开仍处于上次判断阶段，未出现空白答题入口。重连后第一条记录真实返回 false | 6.2 failed；复现旧 FOLLOWUP-REVIEW。修复弹窗状态初始化并补同题重复打开测试；不能改服务端 bool 合同来伪造 null       |
| R-02 | E06 下载 ZIP、sha256 与五个成员文件通过；`integration-hub.tsx` 按钮和备用路径仍写“创建加密导出”                                          | 8.3 failed；T-06 加密文案遗漏互操作入口。应与 Data 的“服务端加密存储、下载为可读 ZIP”一致，并说明下载后未加密       |
| R-03 | E06 Review 320px axe：成功 Toast 文本 `#008a2e` / 背景 `#ecfdf3`，13px，实测 4.25:1，要求 4.5:1                                          | T-03 反馈状态缺陷；阻断 Review 完整断点循环。修复成功态颜色后重跑显示 Toast 的状态；静态 Lighthouse 高分不能抵消    |
| R-04 | E11 八页 `label-content-name-mismatch` 指向 `a.persona-indicator`；aria-label 未包含可见画像说明                                         | 13.3 failed；另有 Today skip-link、Records/AI heading-order。问题涉及受保护 app-shell，当前只记录，不恢复 T-04 施工 |

R-01 和 R-03 均有本轮真实失败，不属于测试代码修正后消失的误报。R-04 是 Lighthouse
experimental、权重为 0 的辅助审计，仍有明确失败元素和可访问名称差异；不能因页面得 100 分
而把 13.3 填为通过。除上述根因证据外，未推断未测过的生产影响。

## 测试修正与未决项

- `integration-hub.spec.ts` 的画像成功文案同时出现于 inline 与 Toast，旧定位违反 strict mode；
  将断言限定在 workbench 后，原串行 5 项通过。原先未执行的 4 项没有被直接标通过。
- `workbench-audit.ts` 原先把非滚动图标的内部 `scrollWidth` 当作横向滚动，且采样处于断点动画中。
  现在等待有限动画结束，仅将 auto/scroll 容器的内部溢出视为滚动，同时保留页面总宽与元素越界检查。
  修正后 Review 的布局步骤通过，随后出现真实 R-03，未隐藏 axe 失败。
- E01 的 Mastery 两例第二次确认报 `OFFLINE_INPUT_INVALID`，Sync 出现非空 Outbox 断言失败。
  两者独立账号重跑通过；无 mock 的两次 Mastery 确认也通过。整组顺序/共享数据问题根因仍未证实，
  保留 FOLLOWUP-TEST-ISOLATION，不把孤立成功解释为整组无不稳定性。
- 补验早期纠正了 Goal 实体名、阶段嵌套存储、Sync 冲突标签选择、Review 带计数的标签定位，
  以及附件通用队列码和精确行内错误的区别。预算未知错误使用现有中性文案及请求编号，未要求展示
  未定义业务码。所有初轮失败日志保留；没有降低持久化、权限或真实错误断言来制造通过。
- 导入仅完成真实 Markdown 预览/提交 smoke，未补全大小上限、冲突、其他格式与专门持久化回读。
  Provider 发现仅验证交互与响应合同；真实 DNS、连接和生产参数继续由 OPS-03/04 跟踪。

## 清理与交接

只对验证过所有权的 M5 独立数据库清理，先确认全部账号均为本轮合成前缀，再清空业务表；
没有清理其他本地栈或生产数据。清理覆盖邀请、成员、角色、Provider、导入/导出、学习记录与会话。
独占 Redis 归零；Playwright teardown 删除认证文件，Lighthouse profile 在关闭后删除。
空库、本地 API/Web/Worker 与不含账号口令的报告、截图和测试脚本保留，便于后续复现。

T-04 三个受保护文件的 SHA-256 与开工记录一致，仍未暂存；其他所有者文件保留。
本轮结果文档及两份浏览器测试修改留在工作树，等待后续 Git 交付，未复用上一批提交授权。
先修复 R-01/R-02/R-03、处理 R-04 的所有权边界并调查整组测试稳定性，再重跑受影响项与最终门禁；
生产身份、真实邮件/读屏及发布前置继续独立跟踪，M6 尚未获得发布通过结论。

## 文档与测试变更复核

本轮 7 个交付文件的定向 Prettier、58 个唯一 ID/六类状态与原 26 项基线统计、56 个本地
链接、两份 TypeScript 测试语法、定向 Gitleaks 秘密扫描均通过；当前 Run validator 通过。
只读复核指出总表仍有四处版本/范围待确认的旧表述，已按生效 D-02/D-06 修正。
其余结果数量、失败附件、Lighthouse、数据清理和测试修正边界均与主线观察一致。
