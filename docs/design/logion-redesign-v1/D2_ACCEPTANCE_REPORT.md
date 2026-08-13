# Logion D2 原型验收报告

## Outcome

`complete`：D2 隔离高保真交互原型完成，允许进入正式前端施工任务包。正式产品代码、API、合同、迁移、依赖和生产配置未修改。

## Prototype

`prototype/logion-redesign-v1/d2-approved.html`

## Observed checks

- `pnpm exec prettier --write prototype/logion-redesign-v1/d2-approved.html`：完成；
- `git diff --check`：通过；
- 原型静态路由映射：21 条唯一旧 URL；`/app` 与历史 `/app/knowledge-prototype` 在设计文档中单独处理；
- D2 主矩阵：桌面浅色、桌面深色、390px 浅色、390px 深色各 50 个场景，共 200 个；
- 每个矩阵覆盖今天、工作台、知识库、协作空间、系统中心，舒适/紧凑密度和就绪/离线/409/能力关闭/错误状态；
- 所有矩阵均观察到：主标题存在、原型设备无横向溢出、Today 并列面板底边一致；
- 工作台 5 种模板、知识库 5 种视图、系统中心 5 个设置分组：桌面和移动各 15 个子视图，无横向溢出；
- `Ctrl/Cmd+K`：命令面板打开，21 条路由映射可见；搜索 `/app/review` 后结果为 1 条；Escape 关闭并回到页面；
- 邀请流程：`existing@example.test` 真实触发原型 409 文案，包含已是成员、恢复动作和 `REQ-INV-409`；不发送真实邮件；
- 图谱：节点选择和 Inspector 联动；方向键将焦点从“RAG 评测”移动到“召回率”；移动端显示同一节点集合的列表等价视图；
- 危险操作：清除本机数据打开确认门，显示影响范围和恢复提示；确认只产生演示反馈，不执行真实删除；
- D2 浏览器控制台 `error/warn`：0 条。

## Not run / not claimed

- 未对正式 Web/API 运行真实认证、axe、生产构建或 Playwright；原型是本地合成数据，不代表产品行为通过；
- 未安装或修改正式依赖；Cytoscape/Radix/Lucide/TanStack 仍需在施工分支逐项精确锁定并审查；
- 未提交、推送、合并、部署或启用任何敏感生产开关。

## Residual risks

- D2 仍需真实用户两级验收中的第二级任务测试；
- 21 路由迁移要保持旧 URL、SessionBoundary、权限、API 请求编号和错误合同；
- 生产前必须重新运行 1440/1024/390/320、axe、键盘、reduced-motion、主题持久化 XSS、Graph 150/400 上限、真实 409 和离线边界。
