# Release Candidate 供应链威胁模型

## 资产与信任边界

受保护资产包括源码来源、四个应用镜像、兼容元数据、发布证据和环境批准。Pull Request 是不可信构建输入；`main`、GitHub Actions OIDC、GHCR、staging 和人类发布负责人是独立信任边界。Production 凭据不参与 Main/RC 候选构建。

## 威胁与控制

| 威胁                          | 预防控制                                                                                               | 证据                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------- |
| PR 发布高权限镜像             | package/OIDC/attestation 写权限只存在于 Main workflow                                                  | workflow 权限审查               |
| 可变 tag 在测试后被替换       | 候选/Compose 使用 `repository@sha256:digest`；manifest 拒绝 tag 和 digest 不匹配                       | manifest 负向测试               |
| RC 重建不同字节               | RC 仅 `pull` + `up --no-build`，只接受成功 Main run                                                    | 发布 workflow 和 run API 校验   |
| 无关 run ID 提供产物          | run 必须匹配 source SHA、`main`、成功结论和 `.github/workflows/main.yml`                               | RC preflight 日志               |
| 源码/兼容元数据被改           | verifier 在检出 SHA 上重算锁文件/OpenAPI hash、迁移 head、sync protocol、offline schema 和 app version | manifest 校验                   |
| 仓库产物无来源证明            | 每个镜像推送 BuildKit provenance/SBOM 和 GitHub OIDC provenance attestation                            | GHCR attestations               |
| secret 进入证据               | 生成器只接收有界 ID/digest，本地计算 hash，不捕获环境 dump                                             | manifest schema 审查            |
| 受控依赖/action 改变构建      | 锁文件冻结并哈希；Dependabot 管理 action；许可证及 HIGH/CRITICAL 门禁阻塞候选                          | lock hash、依赖 PR、扫描 JSON   |
| 浏览器证据漏掉 Safari/PWA     | RC 跑 Chromium/Firefox/WebKit/移动模拟，产物/手册保留物理设备人工签字                                  | Playwright JSON/HTML 与 RC 清单 |
| HTTPS-only CSP 破坏 HTTP 验证 | 仅真实 HTTPS 请求发 `upgrade-insecure-requests`，其他 CSP 仍失败关闭                                   | WebKit HTTP 回归门禁            |
| 合成指标晋级实时流量          | 证据记录 mode/source；Production 拒绝合成样本并要求同候选有序证据                                      | rollout gate 负向测试           |
| 监控泄露学习内容              | 样本 schema 是精确聚合白名单，未知或含内容字段失败关闭                                                 | 可观测性契约与负向测试          |
| 自动化改变 Production 流量    | 门禁只输出决策，无流量/审批权限；受保护流量变化由人类执行                                              | 手册、证据 JSON、环境 ACL       |

## 残余风险与后续控制

L6-001 建立身份与晋级不变量；L6-002 扫描每个 digest、仓库文件系统和 IaC，验证 attestation 并执行生产依赖许可证策略；L6-003 加入隔离恢复和浏览器兼容证据；L6-004 提供云中立聚合可观测性和分阶段决策契约，但不具备改流量权限。仓库保留、包访问、物理 Safari/iOS、屏幕阅读器、真实云发布和异地灾备仍需操作员证据。成功 Main/RC run 不等于发布批准。
