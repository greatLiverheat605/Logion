# ADR-0001：单仓库与模块边界

- 状态：Accepted
- 日期：2026-07-19
- 决策人：Logion project owner

## 背景

首发同时涉及 Web、FastAPI、Worker、离线协议、契约、基础设施和跨端测试。多个 AI/人员可能并行执行，若各自复制 DTO、枚举或工程配置，会快速产生漂移。

## 决策

采用 pnpm + uv 管理的单仓库。顶层边界固定为 `apps`、`packages`、`infra`、`tests` 和 `docs/adr`。Web、API、Worker 可独立构建和部署，共享契约只由 `packages/contracts` 的生成链维护。

后端依赖方向为 transport → application → domain → port；adapter 实现 port。前端页面通过 feature client 消费生成契约。禁止跨模块直接访问内部表、repository 或私有组件。

## 后果

- 契约变更可以在一次提交中验证前后端兼容性；
- 单仓 CI 和依赖安装较重，需要受影响路径筛选；
- 共享文件必须实行单写者与合并队列；
- 若未来拆仓，先稳定公开包、事件和版本策略，再通过新 ADR 迁移。
