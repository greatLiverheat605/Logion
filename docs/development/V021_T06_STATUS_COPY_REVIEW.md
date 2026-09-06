# T-06 状态与文案一致性实施报告

- 日期：2026-09-06。
- 状态：五项直接修复已实施，等待所有者审查；StudySession 生产复现 blocked，整仓聚合门未通过。
- 基线：`64b6d4bdc4a7890cfb2a2304acb138ba71580ee3`，父提交 `dd664fc`。
- 工作分支：`dev/T-06-status-copy-consistency`，HEAD 不变，暂存区为空。
- 未执行 stage、commit、push、PR 创建、部署；没有修改后端、契约或 StudySession 实现。

## 实际改动

| 子项       | 文件与实现                                                                                                                                                         | 验证                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 判题布尔值 | `apps/web/src/features/memory/review-workbench.tsx` 的 QueuePanel 就地严格判断 `true`、`false`，其他值显示“尚未判定”；不修改同步状态映射                           | 新增 5 项渲染测试，覆盖 true/false/null/缺失和未作答；浏览器分别验证正误文案                                    |
| 导出容量   | `apps/web/src/features/data/data-workbench.tsx` 的 `bytesLabel` 增加 KB 档                                                                                         | null、0、1023、1024、1048575、1048576 六个边界均通过                                                            |
| 导出文案   | 同文件按空态、标题、按钮和 Sheet 语境重写七处，新增下载文件未加密提醒                                                                                              | ADR-0019 已完整核对；测试验证 24 小时、服务端加密、可读 ZIP 及五类格式；搜索旧“加密数据包”无命中                |
| 条件轮询   | `apps/web/src/features/data/use-data-controller.ts` 复用 `loadPortability`，只对当前 Workspace 的 queued/running 导出每 5 秒读取；终态、错误、离线、隐藏或卸载停止 | 新增 14 项 fake-timer 测试；真实导出 queued → succeeded 自动更新并下载                                          |
| 登录回跳   | `apps/web/src/features/auth/login-form.tsx` 的共享认证完成路径读取 next；原值及一次解码后均拒绝非单斜杠路径、反斜杠、解析失败和异源 URL                            | 新增 19 项测试，覆盖任务书全部拒绝/接受值、编码绕过、待删除优先、入门门禁及设置读取失败；真实密码登录回到数据页 |

容量显示沿用本模块原有 B/MB 以及 `features/content/records-workbench.tsx` 的 B/KB/MB 风格，
不是声称仓库所有位置统一采用该单位。当前按 1024 换算，1048575 字节因既有一位小数策略
显示 `1024.0 KB`；1048576 字节显示 `1.0 MB`。

轮询增加读取代次，防止旧 Workspace 响应覆盖新 Workspace，也防止旧轮询覆盖用户操作失败。
慢请求未结束时不启动下一次轮询。失败沿用已有错误状态和重试入口，不猜测终态、不自动改成成功。
保留现有 inline/aria-live、确认框和认证失败重试语义；后台刷新不主动移动焦点。
本轮遵循最小改动技能复用既有服务，UI 技能仅用于状态反馈与可访问性核对，没有新增依赖或视觉重构。

测试文件为 `login-form.test.ts`、`data-workbench.test.tsx`、`use-data-controller.test.ts`、
`review-workbench.test.tsx`。新增浏览器文件 `tests/browser/status-copy-consistency.spec.ts`，
并只在 `playwright.config.ts` 的认证用例匹配表达式中加入该文件。

## 实跑门禁

实际执行根级 `pnpm ci:fast`，退出 1。执行前 `packages/offline/coverage` 不存在，
第 1、2 门通过，第 3 门仅因既有未跟踪的 `sisyphus/PROGRESS.md` 格式报警停止。
没有修改、移动、忽略该文件来规避门禁。后续五门另行逐项完整执行，不能把这些单项通过
合并表述为“ci:fast 八门全过”。

| 命令                     | 本轮实际结果                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm ci:fast`           | 失败，停止于 `format:check`，不是未执行                                                                                    |
| `pnpm guard:context`     | 在聚合命令中通过                                                                                                           |
| `pnpm agent:state:check` | 在聚合命令中通过，118 tests；新 T-06 本地 Run 另行 validate 通过                                                           |
| `pnpm format:check`      | 在聚合命令中失败，唯一报警 `sisyphus/PROGRESS.md`；T-06 文件另行定向格式检查                                               |
| `pnpm lint`              | 独立完整执行通过，Web/offline ESLint 和全仓 Ruff 均通过                                                                    |
| `pnpm typecheck`         | 独立完整执行通过，TypeScript 与 API/Worker mypy 181 文件通过                                                               |
| `pnpm test`              | 第二次完整执行通过：Web 392、offline 68、contracts 13、mobile 4、Python 606 passed / 109 deselected；offline branch 85.52% |
| `pnpm build`             | 独立完整执行通过，默认 Turbopack 构建，35 个静态页面生成步骤完成                                                           |
| `pnpm contracts:check`   | 独立完整执行通过，重新生成后契约无未提交差异                                                                               |

定向命令：`pnpm --filter @logion/web exec vitest run src/features/auth/login-form.test.ts src/features/data/data-workbench.test.tsx src/features/data/use-data-controller.test.ts src/features/memory/review-workbench.test.tsx`，
4 个文件、48 tests 通过，其中 45 项为本轮新增，3 项为原有测试。

失败历史保留：首次定向测试已通过，但首次类型检查发现 4 处新增测试夹具/API 类型错误，
修正后通过。首次全量 `pnpm test` 的 Web 为 387 passed / 5 failed，输出包含既有 Today
测试 5000ms 超时；当时与构建任务重叠。随后未修改这些既有测试或超时设置，重跑完整命令
全部通过；不把并发负载推断当作已经证明的全部失败根因。

## 真实浏览器

在独立本地数据库、Redis 逻辑库、API、仅处理导出的 Worker 和本轮候选 Web 上验证，
使用合成账号。候选由 HEAD 加 T-06 文件构成，T-04 三文件在候选内使用 HEAD 版本，
源工作树中的 T-04 改动原样保留。没有使用 mock API 返回值或伪造导出状态。

候选目录复用依赖符号链接时，pnpm 自动安装保护及 Turbopack 根目录限制阻止直接构建，
因此浏览器候选使用已安装的 `next build --webpack`，结果通过；源工作树默认 Turbopack
构建另外实跑通过。前期本地 origin 校验失败已修正临时启动配置，没有改生产配置。

执行 `node /tmp/t06-stack.mjs test --max-failures=1`，内部实际运行：

```text
playwright test tests/browser/status-copy-consistency.spec.ts
  --project=authenticated-chromium --reporter=line --output=<本次临时目录>
```

1440x900 与 320x900 各覆盖登录回到 `/app/data`、导出确认文案、真实后台 queued →
succeeded 自动更新、KB 容量、下载 ZIP 以及正确/错误回忆文案。ZIP 的 Content-Type、
实际长度与服务端 artifact_bytes 一致，文件头是 `504b0304`。没有通过手动刷新完成状态断言。

最终一轮为 **6 passed（45.1 秒）**，此前一轮同样为 6 passed（44.4 秒）。最终 14 张截图保存在
`/tmp/t06-browser-verification/run-1788701855939/`，桌面/窄屏目标截图已人工查看，
新增目标文案可读、没有互相覆盖。额外补充滚动后的下载入口截图。320px 的数据工作台沿用原有纵向滚动布局，下载入口需要滚动；
本轮不宣称移动端外壳或全页面无障碍门禁通过。

早期失败证据保留在临时目录：首次定位器误把导出行放在侧栏，另一次误要求始终存在可见的
移动区域切换按钮；均修正测试，不据此修改产品结构。第二次浏览器运行为 3 passed / 1 failed /
2 did not run；首轮在两个失败后中止，不能计为完整回归通过。

## StudySession 与待确认项

StudySession：**blocked，未执行认证后的复现**。本轮打开生产 Today 页面观察到“需要登录”，
没有有效生产会话，也没有所有者指定的测试 Workspace/Task。未执行开始/结束、离线重连或跨设备
pull，没有该行的响应体或 IndexedDB outcome 证据。不称“未能复现”，不预设根因，不修改
`today-workbench.tsx` 或 `use-today-controller.ts`。需所有者在浏览器完成登录并指定可测试对象，
不要把密码写入聊天、文件或报告。

任务书引用的 `docs/gpt_work/LOGION_AI_DEVELOPMENT_CONSTRAINTS.md` 在当前工作区不存在。
已遵守任务书明确列出的不变量 10/11，现行完整文档路径仍待提供。

Mastery：仅确认、不改代码。`review-workbench.tsx` 的 Inspector 显示 confirmed_level 和
suggested_level，未使用 `suggested_reason`；`masteryRate` prop 未渲染。因此“不显示百分比”
满足，但“等级与建议理由均显示”目前不满足，已上报而非伪装通过。是否另行补建议理由由所有者决定。

范围外浏览器观察：同页保存答题后第二次打开 AnswerSheet，仍停留在确认阶段，找不到“提交回答”。
现有保存关闭路径直接调用父级回调，未经过内部重置 phase 的 Radix 回调。此路径本轮没有修改；
正误文案最终分别以独立测试场景验证，不将其当作重复答题流程已修复。需另行审查处置。

## 未执行与交付边界

- 未执行生产 StudySession 复现、生产部署、真实设备读屏和跨设备复现。
- 未执行额外数据库集成套件、迁移往返、全站浏览器回归、Firefox/WebKit 或全站 axe 检查。
  本地为浏览器新建数据库执行过 `alembic upgrade head`，不等同于迁移往返验收。
- `test_memory_sync_integration.py`、T-04 三文件与 `reports/browser/results.json` 未修改；
  后四者与本轮开工 SHA-256 一致。`docs/ai_handoff/`、T-04 报告及 `sisyphus/` 保持原样。
- 本地 Run 仅记录范围批准和待审查任务，不将本轮自测升级为独立审查 accepted；T-05 历史事件未改写。
- T-06 的 12 个交付文件定向 Prettier 检查通过，`git diff --check` 通过；
  契约、StudySession 两个文件和 memory 同步集成测试相对 HEAD 零差异。
- 没有清理旧数据库。临时环境准备失败留下的空测试库和候选目录保留，未删除任何既有用户数据。
  本地候选 URL 为 `http://127.0.0.1:8082`，不属于部署或生产环境。

建议下一步：所有者审查五项直接修复，提供 StudySession 复现前提及现行不变量文档，
分别决定格式阻塞、Mastery 理由和重复答题阶段问题的归属。本报告不声明 T-06 全量完成。
