# Logion D2：方向冻结与施工前批准记录

> 日期：2026-08-11（Asia/Shanghai）
>
> 基线：`e2b85987d816baf53a089007e674cd440e9ce64f`
>
> 状态：D2 隔离原型已完成并通过本轮原型验收；本文件只冻结前端重构输入，不代表 Production 发布或敏感能力开启。

## 1. 冻结结论

本轮采用以下组合进入正式前端施工：

```text
C Adaptive Desk（自适应认知桌面）作为外壳和主结构
+ B Evidence Studio（证据工作室）的 Knowledge / Research 三栏证据结构
+ A Focus Lane（专注行动线）的 Today 极简行动组织
```

选择原因：

1. C 能让学习、研究、考试、导师和受控自定义工作台共享一个对象内核，同时保留各自最合适的任务模板。
2. B 的来源、阅读器、声明、证据和 Inspector 结构是 Logion 的主要差异化，适合已批准的“学、研主导”定位。
3. A 的 Today 只回答“现在做什么、为什么、完成需要什么证据”，能降低首次进入后的认知负担。

这不是三套产品并存，也不是给页面换三种颜色。正式实现只有一个应用外壳、一套 tokens、一套命令状态和一套对象语义。

## 2. 不可变产品决定

- Today 是默认行动入口；Knowledge Base 是长期资产中心。
- 一个用户可见知识库直接对应一个后端 `Space`；Collection、Tag、Saved View 只负责库内组织。
- 正式对象只有一份；工作台、知识库视图和研究模板保存引用与投影，不复制对象、不改变权限。
- 工作台是受控自定义：可配置模块、顺序、视图、筛选、流程模板和有限属性，不创建任意对象类型、权限、脚本或同步规则。
- 研究共享一套内核；第一批模板是学术研究和技术研究。
- 图谱采用正式关系与探索关系双层模型。AI 关系永远先是候选，正式关系必须人工确认。
- 桌面首版是单窗口专业工作区，使用受控分栏、Inspector、历史、固定对象和命令面板；应用级标签与原生多窗口后置。
- AI 上下文触发、Draft-first，不常驻占据主视图，不静默改变正式判断。
- 新知识实体首版 online-only，不进入 sync-v1；Shared Write、Deletion、Attachment、Local Worker、Provider 和 AI Acceptance 生产开关继续关闭。

## 3. D2 原型覆盖

隔离原型 [`prototype/logion-redesign-v1/d2-approved.html`](../../../prototype/logion-redesign-v1/d2-approved.html) 覆盖：

- Today：当前行动、Why、Evidence、Next、会话继续、证据提交、历史回跳；
- Workbench：学习、研究、考试、导师、自定义五种受控模板；
- Knowledge Base：Sources、Topics、Graph、Review、History 视图；
- Research：Source 列表、Claim 编辑、Evidence Inspector、AI 候选；
- Collaboration：Workspace/Space 语义、成员列表、邀请和 409 恢复；
- System Center：账户与外观、安全、数据与同步、AI 治理、互操作；
- 21 条旧路由的命令面板映射；
- 桌面与 390px 等价路径、舒适/紧凑密度、Light/Dark、就绪/离线/409/能力关闭/错误状态；
- 图谱节点选择、Inspector 联动、方向键导航、移动端列表替代、危险操作确认门。

## 4. 进入施工的边界

本文件及 D2 原型可作为正式前端施工输入。施工方必须先阅读同目录的 `08_D2_PROTOTYPE_SPEC.md`、
`09_DESIGN_SYSTEM.md`、`10_ROUTE_MIGRATION_MAP.md` 与 `I0_CONSTRUCTION_TASK_PACKET.md`，再按批次施工。

原型是合成数据和本地状态，不是生产 API 通过证据。正式实现必须使用既有认证边界、`browserApiClient`、
现有领域对象和能力关闭状态；不能把原型中的静态数据、演示请求编号或任何假成功写入产品。

## 5. 审批边界

- 本轮指令授权进入正式前端施工任务包阶段；具体 commit、push、merge、部署和生产开关仍需单独授权。
- 正式施工技术验收通过不等于产品发布批准。
- 若施工需要改 API、OpenAPI、数据库、迁移、sync-v1、权限模型或生产配置，必须停止并重新进入架构门，不得在前端任务中顺手修改。
