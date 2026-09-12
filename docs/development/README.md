# 开发指南

Logion 是 pnpm + uv monorepo。贡献流程见 [CONTRIBUTING.md](../../CONTRIBUTING.md)，产品行为见[操作手册](../user-guide.md)。

## 环境

- Node.js 24.14+、pnpm 11.9+
- Python 3.12、uv
- Docker Compose v2，用于 PostgreSQL、Redis 和完整集成测试

```bash
pnpm install --frozen-lockfile
uv sync --all-packages --group dev --frozen
```

参考[本地体验](../../README.md#本地体验)准备 `.env` 和备份密钥。完整栈可以直接用 Compose；若要在宿主机分别启动 Web/API/Worker，需要自行准备可从宿主机访问的 PostgreSQL 和 Redis，并在进程环境中覆盖 `LOGION_DATABASE_URL` 与 `LOGION_REDIS_URL`。默认 Compose 的数据库端口仅在内部网络可见。

## 启动与迁移

配置依赖连接、可信 Origin 和本地密钥后，先迁移：

```bash
uv run --package logion-api alembic -c apps/api/alembic.ini upgrade head
```

分别在三个终端启动：

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

开发 Web 默认端口为 3000，API 默认端口为 8000。访问地址必须与配置中的可信 Origin 和 WebAuthn Origin 一致。

## 质量检查

```bash
pnpm ci:fast
```

该命令执行上下文检查、协调工具测试、格式、Lint、类型检查、单元测试、构建与契约一致性检查。测试夹具使用合成数据；正式服务与个人数据库不应用作可清空的测试环境。

按改动范围运行定向检查，例如：

```bash
pnpm --filter @logion/web test
uv run --group dev pytest apps/api/tests/test_ai_generation.py
pnpm contracts:check
pnpm test:sync-compat
```

OpenAPI 与同步契约变化使用 `pnpm contracts:generate` 生成，再审查实际差异。不能仅通过手改生成快照使检查变绿。

## 浏览器测试

公共页面项目需要运行中的 Web：

```bash
LOGION_E2E_BASE_URL=http://127.0.0.1:3000 pnpm test:browser
```

完整认证测试需要隔离的真实栈。为该测试环境设置 `LOGION_REGISTRATION_MODE=open`、`LOGION_LEGACY_REGISTRATION_ENABLED=true` 及足够的注册/登录限额，然后执行：

```bash
LOGION_E2E_BASE_URL=http://127.0.0.1:8080 \
LOGION_E2E_PROVISION_ACCOUNTS=true \
LOGION_E2E_REQUIRE_AUTHENTICATED=true \
pnpm test:browser
```

自动建号仅允许回环地址。账号和会话按 worker 隔离，临时认证状态位于被忽略的 `test-results/.auth`。远程测试环境使用预先批准的专用账号，不允许自动向生产批量注册。

UI 几何与路由合同使用[合成测试清单](../../tests/browser/fixtures/ui-targets.json)。可选原始视觉参考通过 `LOGION_GLM_TARGET_ROOT` 指定；缺失时对应原图核验会明确跳过，其他结构与浏览器断言仍运行。说明见 [UI 一致性检查](ui-conformance.md)。

## 维护文档和目录

| 内容                           | 位置                                                |
| ------------------------------ | --------------------------------------------------- |
| 产品源码与单元测试             | `apps/`、`packages/`                                |
| 浏览器及跨模块测试             | `tests/`                                            |
| 可复用的合成数据               | 对应测试目录的 `fixtures/`                          |
| 用户功能与操作                 | `docs/user-guide.md`、`docs/product/`               |
| 配置、发布与恢复               | `infra/`、`docs/operations/`                        |
| 设计依据                       | `docs/adr/`、`docs/architecture/`、`docs/security/` |
| 临时报告、截图、会话与工作计划 | 本地忽略目录或 CI artifacts                         |

删除报告前先检查是否被测试读取；可执行测试依赖应迁入 fixtures。不要提交真实凭据、机器专属路径、构建缓存或个人验收记录。

可选协调工具的 JSON Schema、校验器和合成夹具属于开发源码，详见[状态模型](AGENT_STATE_MODEL.md)。它们不要求使用特定 AI 客户端才能参与项目。
