# Logion

Logion 是面向长期学习与研究的离线优先、证据驱动操作系统。本仓库目前处于 **Phase 0：工程实施准备**，只包含工程底座、契约、健康检查、测试和部署骨架，不包含学习业务功能。

## 权威基线

开发前必须完整阅读：

1. `LOGION_EXECUTION_PLAN.md`
2. `LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`

归档资料和交互原型用于追溯与设计评审，不是生产业务事实。

## 环境要求

- Node.js 24.18+
- pnpm 11.9+
- Python 3.12
- uv（Python 环境与锁文件）
- Docker Compose（本地完整服务；当前也可分别运行 Web/API）

## 常用命令

```text
pnpm install --frozen-lockfile
uv sync --all-packages --group dev --frozen
pnpm contracts:check
pnpm ci:fast
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

完整环境使用 `docker compose up --build`。生产密钥不得写入 `.env.example`、Git、前端或日志。

## 当前边界

- Web：`apps/web`
- FastAPI：`apps/api`
- Worker：`apps/worker`
- 权威契约：`packages/contracts`
- 共享工具配置：`packages/config`
- 部署、监控和备份：`infra`
- 跨模块验证：`tests`

任何跨边界变更先记录 ADR。任何业务对象都不得预装或写死真实导师、课题组、考试、课程或研究方向。
