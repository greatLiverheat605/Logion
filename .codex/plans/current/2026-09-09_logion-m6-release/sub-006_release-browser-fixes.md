# M6 Release 浏览器门缺口修复

- 父计划：[M6 发布计划](../2026-09-09_logion-m6-release.md)，步骤 2 的直接子计划。
- 状态：本地技术验收完成；十文件代码提交为 2cefbcf，草稿 PR #235 已创建。本文提交时，文档交付后的最终 head 远端检查和具体 main 合并批准仍待完成。
- 固定修复基线：94c15f4a948c37081ea28fadd7010f2c30ba15e0，独立分支 codex/v021-m6-release-browser。
- 允许修改：AI 系统页选中标签的文字色、画像提示定位、清除此设备验收的笔记身份，以及相应明暗主题浏览器覆盖和状态文档；完整复验发现的附件行身份缺陷、导出任务定位与模板验收认证前提一并修复。
- 不改 API/权限/同步合同，不使用旧 PR 公共浏览器通过代替完整认证浏览器门，不降低 axe 标准或删除测试。

## 步骤

1. 保存失败原件，核对三处失败与未运行项；独立检出定位根因。
2. 复用 accent-text 修正选中标签颜色；提示断言限定工作台；设备清除用当前选中笔记 ID；显式验明暗主题。
3. 在隔离本地真实栈执行聚焦与完整浏览器验收，复核必要静态/构建门和最终十文件差异；准备具体 Git 交付。
4. 新 main 合并须绑定最终可审阅差异及授权；合并后重新核对同 SHA Main/capacity/Release，旧失败与成功均保留。

## 已观察的失败

浏览器 246 passed、3 failed、14 skipped、4 因串行前置失败未运行，零 flaky。报告 JSON skipped 合计 18，不能把其中四项未运行写成既定跳过。失败为深色 Draft 标签 2.71:1、画像提示匹配到持久提示和 Toast 两处、笔记测试误选后台补齐的旧记录。

候选启动、容量/manifest 校验、空环境恢复、真实旧端兼容步骤已经通过；灰度政策因浏览器失败未运行。生产、额外邮件和 Provider 未执行。

## 本地完整复验与根因补记

2026-09-10：第一轮有效完整 CI 通过（Web 433、Python 614、offline 74）；补齐画像导航 exact 定位后，原三处缺口及关联串行流程聚焦 10 passed、零失败或 flaky。随后完整浏览器为 248 passed、4 failed、1 flaky、14 既定跳过、1 未运行，失败原件保留。

- 导出一直 queued、后续导出 409：本地辅助执行器漏启 Worker；补齐独占 Worker 与 heartbeat，导出密文继续存在独占测试 PostgreSQL，不改产品队列策略。
- 官方模板安装返回 AUTH_RECENT_LOGIN_REQUIRED：测试复用的登录超出近期认证窗口；安装前走真实登录表单，不放宽服务端权限。
- T05a 首次失败并非超时：点击指定附件却处理同时间入队的另一项。底层 uploadPending 增加可选附件 ID，UI 传入点击行 ID，并复核 Workspace 和 pending 状态；原按队列处理的调用保持兼容。增加同时间多文件、失效/跨 Workspace/非 pending ID、重试和 UI 目标行回归；原离线移除浏览器断言保留。

该轮修复范围为九文件：原四文件加 offline resilience 实现/测试、OfflineSyncCenter 实现/测试、templates 浏览器用例。未改 sync-v1 wire、数据库 schema、API 权限或开关。新产品字节触发完整 CI、补齐 Worker 的聚焦与完整浏览器复验，实际结果待记录。此前执行器 Origin、coverage 路径、umask 和健康 URL 错误均保留，不能计为产品门禁通过。

## 最终本地验收与 Git 交付（2026-09-10）

local-7 的新增测试 stub 因无 await 的 async 触发 lint，改用明确的 Promise.resolve/reject 后复验；原失败保留。local-8 完整 pnpm ci:fast 通过：Web 433、offline 75、Python 614，格式/lint/type/build/contracts 通过。

local-8 聚焦为 4 passed、1 flaky；完整浏览器为 252 passed、2 flaky、14 既定 skipped、零 failed。虽然命令 exit 0，仍不计为浏览器验收通过：

- 导出用例选择了旧任务第一行；现在等待实际轮询响应，并按新建 job ID 找到对应行，保留大小、状态及下载 ZIP 内容断言。
- 模板用例清 Cookie 时旧页面仍发送后台请求，留下三个 401；现在先导航 about:blank，再清 Cookie 并走真实登录，权限及错误捕获标准保持。
- 自学反馈曾遇本地 Next 代理与 API keep-alive 断开而返回 500。辅助执行器调整 API keep-alive 为 65 秒；Release 使用 Nginx 直连 API，此处没有改产品或断言。

最终范围十文件，在九文件基础上加入导出浏览器定位。local-9 使用独占 API/Web/Worker/PostgreSQL/Redis 与现有 production Web 构建，聚焦 7 passed、零失败/跳过/flaky；完整 254 passed、14 既定 skipped、零 failed/flaky，合计 268。两次浏览器命令均启用 --fail-on-flaky-tests；报告与十文件字节摘要一致。自有服务/容器收尾完成，真实 Provider/邮件新增均零。

代码已提交推送为 `2cefbcf237a8f0cbb9e089b9f4b73c803fe0b27a`，[草稿 PR #235](https://github.com/greatLiverheat605/Logion/pull/235)以 main `94c15f4` 为基线。25 份 Markdown 另作独立提交；远端 fast/integration/browser 必须绑定该最终文档提交后的 PR head，不能借用代码提交的绿灯。完成后在 PR 与本地追加记录中保存实际 head/run 和制品摘要，再请求具体合并批准。

新的 main 仍须重新通过 Main/capacity/Release。旧 Release 失败、local-6/7/8 失败或 flaky 均保留，不写成生产成功；独立 review task 保持 pending。
