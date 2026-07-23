# ADR 0023: Main 构建不可变候选，RC 只按 digest 晋级

- 状态：Accepted
- 日期：2026-07-23
- 范围：Phase 6 / L6-001

## 决策

Main 对同一源码提交分别构建 Web、API、Worker 和 Backup 镜像，只向小写 GHCR 路径推送以完整 Git SHA 标记的镜像。每个镜像启用 BuildKit SBOM/provenance，并由 GitHub OIDC 生成 registry provenance attestation。候选清单绑定源码仓库和 SHA、四个镜像 digest、应用版本、Alembic head、同步协议、离线数据库 schema 及 OpenAPI/锁文件 SHA-256。

Release Candidate 输入必须同时提供成功 Main 运行 ID 和完整源码 SHA。工作流先通过 GitHub API 验证该运行属于 `main`、使用 Main candidate 工作流且成功，再下载其候选清单，在对应源码 checkout 上重算所有兼容性和文件哈希。RC 仅执行 `docker compose pull` 和 `up --no-build`，不得重新构建。

## 理由

只使用可变 tag 或在 staging 重建无法证明被测试的二进制就是待发布二进制。单独记录 Git SHA 也不能覆盖依赖解析、构建环境或镜像替换。digest、清单、SBOM 和来源证明共同建立从源码到候选的可核验链路。

## 后果

- Main 需要最小化的 `packages: write`、`id-token: write` 和 `attestations: write`；PR 工作流不获得这些权限。
- 已推送候选不得因工作流回退而删除；失效候选通过状态和保留策略处理。
- RC/staging 仍需人工环境批准；production 必须另行人工批准，本文不授予自动发布权。
- 候选清单和证据禁止包含 cookie、token、密钥、用户内容或环境 secret。
- BuildKit attestation 不替代 L6-002 的镜像漏洞/IaC 扫描和策略门禁。
