# T-06 剩余工作实施报告

日期：2026-09-06。状态：部分完成，生产复现与推送 blocked，等待所有者恢复认证条件。

## 基线与范围

- 分支：`dev/T-06-status-copy-consistency`。
- 基线及当前 HEAD：`821a9acc77f0a13b85b1b7a05b4b4ccf4fe64e8f`。
- 当前任务批准 Mastery 理由显示、StudySession 先复现后修复、恢复推送，以及两项完成后一次提交。
  此授权替代上一轮禁止 Git 写入的任务边界，旧报告与旧 Run 保留为历史。
- 未满足两项完成的提交条件，本轮未 stage、未创建新 commit；未 merge、未部署。

## StudySession：认证前提阻塞

真实浏览器访问 `https://logion.work/auth/register`，页面显示“受邀注册”，只有邮箱确认流程。
使用本轮受控临时邮箱实际提交一次“发送确认邮件”，页面返回：

> 如果该邮箱可以注册，确认邮件会在稍后送达。

随后刷新收件箱并目视检查，仍无确认邮件。此响应是防枚举的条件消息，不能当作注册成功，
也不能据此断言服务端已关闭注册或邮件服务故障。尚未获得登录会话，已向所有者请求可用测试
会话或恢复可注册入口。测试邮箱及密码不写入本报告或仓库。

| 项目                              | 本轮实际执行与结果                                                    |
| --------------------------------- | --------------------------------------------------------------------- |
| 注册确认请求                      | 真实浏览器提交 1 次，返回条件确认消息，未收到确认邮件                 |
| onboarding、创建 Workspace / Task | 未运行，未登录                                                        |
| 开始 / completed / abandoned      | 均为 0 次，未运行                                                     |
| 断网排队、重连、跨设备 pull       | 未运行                                                                |
| IndexedDB 的 session outcome      | 未读取，无可报告观测值                                                |
| study_session 同步响应 payload    | 未捕获，无可报告片段                                                  |
| 根因与修复                        | 未确定根因，不改 StudySession 代码，也不改显示兜底                    |
| 新增 StudySession 回归测试        | 未编写、未运行，因未通过复现门禁                                      |
| 线上测试数据清理                  | 未创建 Workspace、Task 或会话，无此类数据待清理；保留一次注册确认请求 |

结论必须写作“认证前提 blocked，认证后复现未运行”，不是“未能复现”。
注册结果截图：`/tmp/t06-remaining-verification/production-registration-result.png`。

## Mastery：已实现并验证

- `apps/web/src/features/memory/review-workbench.tsx`：Inspector 的两个 level 下方增加
  `建议依据`，通过 `suggested_reason?.trim()` 判断是否显示，正文保留原值。
  `null`、缺失、空字符串与纯空白均不渲染该行。
- 复用现有 `MetaList` 的 `dt/dd` 语义、颜色与换行样式，没有新增 CSS、组件、依赖或百分比，
  没有修改 `confirmed_level` / `suggested_level` 的显示逻辑。
- `apps/web/src/features/memory/review-workbench.test.tsx`：新增 5 个用例，覆盖有值和四种空值，
  同时断言两个 level 未改变。该文件定向实跑 10/10 通过。
- `tests/browser/status-copy-consistency.spec.ts`：新增两个真实 Chromium 用例，分别为
  1440×900 与 320×900；各自覆盖有值和无值，以及长理由换行和两个 level 同屏可见。

浏览器数据边界：使用隔离的本地服务端、测试数据库和合成账号，真实创建知识点、确认掌握并同步。
测试仅替换 pull 响应的 `suggested_reason` 并重算 payload hash，以覆盖显示边界；这是渲染夹具，
不是后端生成建议或生产数据正确性的端到端证据。隔离候选的 T-04 文件保持 HEAD 内容，主工作树
内的 T-04 改动未被复制到候选或修改。

最终浏览器命令：`node /tmp/t06-stack.mjs test --grep 'mastery reason'`，实跑 **2 passed (27.2s)**。
证据目录：`/tmp/t06-browser-verification/run-1788706838597/`，四张截图均已逐张查看：

- `mastery-reason-absent-1440.png`
- `mastery-reason-present-1440.png`
- `mastery-reason-absent-320.png`
- `mastery-reason-present-320.png`

保留的失败与中间结果：

- 首跑测试加载失败：根目录无法解析 `@logion/offline`，改为引用现有源码哈希函数后解决。
- 第二轮 2/2 通过，但桌面截图未完整包含 level，后续加强截图定位。
- 加强截图后出现 1 passed / 1 failed：320px 测试鼠标悬停在 Toast 上，自动关闭计时暂停。
  测试改为移开鼠标后等待；未删除反馈 DOM 或改变产品反馈行为，最终两项通过。

## 完整门禁

按照任务要求，先核对并删除限定生成目录 `packages/offline/coverage`，然后在主工作树执行
完整 `pnpm ci:fast`。本轮第一次完整执行已观察到退出 0，八门通过：

| 门                  | 实际观察                                                                  |
| ------------------- | ------------------------------------------------------------------------- |
| `guard:context`     | 通过                                                                      |
| `agent:state:check` | 通过，118 tests                                                           |
| `format:check`      | 通过；本轮未修改其他所有者文件规避检查                                    |
| `lint`              | 通过，包含 ESLint 和 Ruff                                                 |
| `typecheck`         | 通过，mypy 181 个源文件                                                   |
| `test`              | 通过；Web 397、contracts 13、mobile 4；Python 606 passed / 109 deselected |
| `build`             | 通过，35 个页面生成完成                                                   |
| `contracts:check`   | 通过，合同再生成无漂移                                                    |

最终测试文件及本报告完成后，第二次完整 `pnpm ci:fast` 也实际退出 0，八门全过：
agent-state 118、Web 397、offline 68、contracts 13、mobile 4；Python 606 passed /
109 deselected（37.57s）。上述数字来自本轮最终日志，不沿用上一轮报告。
日志保存在 `/tmp/t06-remaining-verification/ci-fast-final.log`，本轮生成的 coverage 移至
`/tmp/t06-remaining-verification/offline-coverage/` 保留，避免再次触发生成目录的上下文扫描问题。
最后仅补录运行结果，未再修改产品或测试代码。

109 个被默认配置排除的 Python 集成项、生产 StudySession、真机屏幕阅读器，以及此前六个
状态文案浏览器场景均未在本轮重新执行，不用历史结果充当本轮证据。

## Push：blocked

- 实际重试 `git push -u origin dev/T-06-status-copy-consistency`，SSH 返回
  `Permission denied (publickey)`；另一次无超时保护的等待已中止。
- 当前 SSH 配置使用已有 GitHub 专用密钥；该密钥与另一把现有 GitHub 相关密钥均未通过认证。
  未打印或覆盖私钥，没有为了绕过权限创建新身份。
- WSL 的 `gh auth status` 显示未登录；Windows 已有 GitHub CLI token 检查显示失效。
- 已尝试官方 `gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key`。
  浏览器设备激活未成功，CLI 最终报 token 交换 `unexpected EOF`，复查仍未登录。
- HTTPS 匿名只读访问仓库可用，但查询任务分支未返回引用。匿名可读不代表拥有 push 权限。
  未永久修改 remote，未完成 HTTPS 授权，不能声称 `821a9ac` 已到达该远端分支。
- 已请求所有者在 WSL 完成 GitHub CLI 登录或提供有效授权渠道，不要求把秘密发到聊天。

## 保护文件与交接

T-04 三文件及既有 `reports/browser/results.json` 的 SHA-256 与开工前逐项相同；没有暂存。
`docs/ai_handoff/`、既有状态记录和其他未归属文件保留，不撤销、不提交。
本轮只追加新的状态摘要，不改写旧阶段结论。本地 Run 更新为 `run-v021-t06-remaining`，
记录新基线与当前授权，校验通过；独立审查仍待进行。

下一步由所有者恢复线上测试入口和 GitHub 凭据。之后继续 StudySession 复现，再决定是否有
需要修复的根因；满足两项完成条件后才一次精确暂存、提交、推送。
