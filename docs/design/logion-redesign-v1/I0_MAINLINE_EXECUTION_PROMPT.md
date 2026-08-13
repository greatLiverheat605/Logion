# 可手工交给主线执行方的施工提示词

下面内容可直接复制给主线执行方。它不绑定模型品牌或客户端。

```text
你现在接手 Logion 的 I0 正式前端重构施工。你的职责是实现和测试，不是重新定义产品方向。

工作区：由协调方指定的正式 v020-integration 工作区。
不可变基线：e2b85987d816baf53a089007e674cd440e9ce64f。
建议分支：codex/logion-redesign-i0。开始前报告绝对路径、分支、HEAD、工作树状态；如果看不到本任务引用的设计文件，立即停止。

先完整阅读：AGENTS.md、docs/development/AGENT_DELIVERY_WORKFLOW.md、docs/development/V020_EXECUTION_PLAN.md、docs/development/V020_STATUS.md、docs/product/SYSTEM_BLUEPRINT_REVIEW.md、docs/product/PRODUCT_DIRECTION_MARKET_ANALYSIS.md、docs/product/PRODUCT_REDESIGN_EXECUTION_PLAN.md，以及 docs/design/logion-redesign-v1/07_D2_DIRECTION_DECISION.md、08_D2_PROTOTYPE_SPEC.md、09_DESIGN_SYSTEM.md、10_ROUTE_MIGRATION_MAP.md、I0_CONSTRUCTION_TASK_PACKET.md。

冻结方向：C Adaptive Desk 外壳 + B 的 Knowledge/Research 三栏证据结构 + A 的 Today 极简行动线。Today 是默认入口，Knowledge Base 直接对应 Space；工作台只保存引用和布局，不复制正式对象、不改变权限。

施工要求：
1. 先做双主题 tokens、App Shell、primitive、统一命令状态、Toast/Inline Error/Request ID/409 Resolver/Confirm Dialog 和键盘焦点管理。
2. 再做五个可见区域：Today、Workbench、Knowledge Base、Collaboration、System Center；21 条旧 URL、/app 承接页和历史 /app/knowledge-prototype 必须保留可访问。
3. 高频顺序为 Today → Knowledge/Review/Graph → Records/Research；再迁移 Collaboration/System Center，最后迁移低频页面。
4. 使用真实现有 browserApiClient、SessionBoundary、Workspace/Space、Task/Source/Excerpt/Topic/Claim/Evidence 等合同。正式产品禁止复制 D2 合成数据、REQ-D2-042、静态假成功或绕过认证。
5. Graph 只接受服务端授权的 1/2 跳 bounded view，最多 150 节点/400 边；正式关系实线，候选/探索关系虚线；桌面键盘导航，移动列表/树等价。
6. AI 只能 Draft/Suggested；Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 扩展和 AI Acceptance 继续 default-off。
7. 邀请、保存、同步、接受和危险操作都要有 validating/pending/success/409/error 状态、就地原因、请求编号、恢复动作和重复提交保护。危险操作必须有影响范围、最近认证和确认门。
8. 优先使用项目评估过的最小依赖集合（Radix 子包、lucide-react、需要时 TanStack、动态 Cytoscape）；每个新增包必须精确版本、MIT/ISC/Apache 许可证记录、React 19/Next 16 兼容、包体与 audit 证据。不要使用 latest、CDN 或运行时全库映射。

唯一实现写入范围：apps/web/src/** 与必要的 apps/web/tests/**。只有完成依赖评估并在报告中列出理由后才允许修改 apps/web/package.json 与 pnpm-lock.yaml。禁止修改 API、Worker、contracts、offline、migration、生产配置、根脚本、.agents/coordination/**、V020_STATUS.md 和 .tmp-v020-rc2/.tmp-v020-rc4/。

每完成一个批次就停止并报告，不要一次性跨过失败门：
- I0-A：tokens、primitives、命令状态、主题/焦点；
- I0-B：shell、五区域和 21 路由适配；
- I0-C：Today、Knowledge/Review/Graph、Records/Research；
- I0-D：Collaboration/Invite 与 System Center；
- I0-E：全量浏览器、响应式、无障碍和回归。

实际运行并记录：
pnpm --filter @logion/web lint
pnpm --filter @logion/web typecheck
pnpm --filter @logion/web test
pnpm exec prettier --check apps/web/src apps/web/tests
pnpm exec playwright test
pnpm ci:fast

浏览器必须真实检查 21 条路由、认证边界、1440/1024/390/320 无横向溢出、Light/Dark、主题值 XSS、防重复提交、409、离线/能力关闭/错误恢复、axe、reduced-motion、移动节点列表和桌面图谱键盘导航。任何未运行项都必须写原因，不能把旧证据或计划当作通过。

不要 commit、push、merge、deploy 或开启敏感生产开关。完成后只返回以下结构化交接：
Outcome: complete | partial | blocked
Base commit:
Working branch:
Changed files:
Commands actually run:
Observed results:
Unrun checks and reason:
Known risks or assumptions:
Working tree status:
Suggested next action for the coordinator:
```
