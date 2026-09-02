# Logion 产品重构 D0 验收报告

## Outcome

`complete`（D0 文档诊断完成；D1/G1 尚未执行，正式前端施工未授权）

## Base commit

`e2b85987d816baf53a089007e674cd440e9ce64f`

## Working branch

`codex/v020-rc6-closeout`

## Changed files

- `docs/design/logion-redesign-v1/00_BASELINE.md`
- `docs/design/logion-redesign-v1/01_ROUTE_SYSTEM_MAP.md`
- `docs/design/logion-redesign-v1/02_CORE_FLOW_COMMAND_MAP.md`
- `docs/design/logion-redesign-v1/03_DOMAIN_CONTRACT_GAPS.md`
- `docs/design/logion-redesign-v1/04_UX_VISUAL_AUDIT.md`
- `docs/design/logion-redesign-v1/05_OPEN_SOURCE_EVALUATION.md`
- `docs/design/logion-redesign-v1/06_D1_DIRECTION_BRIEF.md`
- `docs/design/logion-redesign-v1/D0_ACCEPTANCE_REPORT.md`

## Acceptance mapping

| D0 条件                                                           | 结果                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| 21 条正式路由逐条映射                                             | 完成；表格 21 行，另列 `/app` 与历史原型                     |
| Today、Knowledge、Research、System、Workbench 数据/命令/状态/测试 | 完成                                                         |
| 已实现、默认关闭、未来、无合同分层                                | 完成                                                         |
| Persona/Workbench 差距                                            | 完成；明确 PersonaSetting 不是 workbench-v1                  |
| UX 问题有源码/测试证据                                            | 完成；未运行视觉项明确列为未运行                             |
| 开源依赖精确版本与许可证                                          | 完成；未修改 Manifest/lockfile                               |
| 三套 D1 输入方向                                                  | 完成；未自动选择或批准                                       |
| 写入范围                                                          | 只写 `docs/design/logion-redesign-v1/**`；既有临时目录未触碰 |

## Commands actually run

- Git branch/HEAD/status 与远端核对。
- `pnpm agent:state:validate -- .agents/coordination/runs/run-v020-v11-remediation`。
- 使用 `rg`/PowerShell 对 21 路由、页面/组件、API、领域模型、Feature Flag、测试、CSS 和组件规模做只读核对。
- 使用 `npm.cmd view <package> version license peerDependencies engines dist.unpackedSize time.modified --json`
  查询 9 个候选包。
- 使用 OSV `/v1/query` 对 9 个精确 npm 版本做只读漏洞查询。
- 完成文档后执行的格式、路径、数量与 Git 检查见下节实际结果。

## Observed results

- 正式业务路由数：21；`/app` 是重定向，`/app/knowledge-prototype` 是历史/验收原型。
- React/Next 技术栈：React `19.2.7`、Next `16.2.11`；没有正式 UI/Graph/Table/Icon 依赖。
- 最大正式客户端中心组件为 1772/1732/1607 行；`globals.css` 为 4993 行。
- 9 个 npm 精确版本 OSV 查询当日均为 0 条已知记录；该结果不替代正式安装审计。
- 历史协调 Run 校验失败：`graph.json`、`tasks.jsonl` 编码内容超出 safe-scan budget；没有新派发或账本写入。

## Unrun checks and reason

- 未运行 Web/API 单元、构建或 Browser：本批只修改 Markdown，不改变产品行为；D0 未启动本地认证栈或 Docker。
- 未运行新原型的视觉、axe、键盘、reduced-motion 或性能：D1/D2 尚未生成。
- 未访问生产，不复核真实邮件、邀请、账户、Provider 或受控 Feature Flag。

## Known risks or assumptions

- npm `latest` 是评估时点，不是正式选型锁定；G2 后仍需精确 pin、bundle、peer、license 与 audit。
- 当前源码可以支持 I0～I3 的增量重构，但 `workbench-v1`、Collection、Saved View 和关系语义必须先有
  ADR/合同才能正式持久化。
- 历史 Browser 覆盖是回归基线，不是新设计已通过的证据。
- D0 推荐组合方向，但产品 Owner 尚未通过 G1；不得据此制作正式施工提交。

## Working tree status

预期只有上述 8 个 D0 新文件，以及本轮开始前已存在且保持不动的 `.tmp-v020-rc2/`、
`.tmp-v020-rc4/`。D0 不 commit、不 push。

## Suggested next action for the coordinator

1. 独立检查 D0 文档、格式、21 路由计数与敏感信息扫描。
2. 基于 `06_D1_DIRECTION_BRIEF.md` 制作 A/B/C 四页面双断点、双主题可操作方向稿。
3. 在 G1 让产品 Owner 选择方向或组合。
4. 只对 G1 通过的方向制作 D2 全流程高保真原型。
5. G2 明确批准后，冻结施工 base/branch/paths，生成可手工交给主线执行方的正式任务包。
