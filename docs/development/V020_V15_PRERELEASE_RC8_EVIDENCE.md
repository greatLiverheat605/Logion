# V20-15 RC8 修复候选与发布证据

> 更新时间：2026-09-03（Asia/Shanghai）。
> 本文件是 RC8 进入发布门禁前的证据索引，不代表候选已发布、已部署或已获得 Production 授权。

## 当前结论

- RC7 仍是受控 prerelease 的运行版本；RC8 产品源码已固定为
  `91a02697e193c712c4e0aac7f9f4024daed93fe3`，尚未生成或部署 `0.2.0-rc8`。
- GLM Gate 2、Gate 2 后增量只读复审、Main candidate、Nightly 与 Full capacity 已通过；增量复审结论为
  `PASS / P0=0 / P1=0 / P2=0 / P3=0`。
- `workbench_delete_api_enabled` 与其它敏感 Workbench 能力继续默认关闭；本轮没有启用删除路由、生产
  flag、生产凭据或生产访问。
- 下一发布门是使用同一产品 SHA 与已验证的 Main/Capacity run 触发 `0.2.0-rc8` Release candidate。
  Production、流量切换、真实受邀邮件、实体移动设备验收和至少 24 小时 RC8 观察仍未获完成结论。

## 修复候选身份

RC8 产品源码由 GLM Gate 2 合并、安全门修复与 Nightly 修复三次 `main` 合并组成。后续证据文档提交只归档结果，
不得替代或改变下表中的产品源码 SHA：

| 字段                       | 状态                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| C7 修复实现提交            | `fa8e119e355c8ab733b034e0b58eb21290326c9a`                         |
| GLM Gate 2 合并            | `809054f30c908ee92210d538f3a1178e42bbcce9` / PR #227               |
| RC8 产品源码 SHA           | `91a02697e193c712c4e0aac7f9f4024daed93fe3`                         |
| Main candidate             | `33732478569` / success                                            |
| Nightly assurance          | `33732517630` / success                                            |
| Full capacity              | `33735531223` / success                                            |
| Release candidate          | `0.2.0-rc8` 待触发                                                 |
| Candidate manifest SHA-256 | `931e70667728b8f670907ebfe5f29c402939075cde8bdf43165099c8e0cd8fc8` |
| Capacity profile SHA-256   | `15db3da761f17a0ef4d5b1cbbc4605d56a6af952a2289bc27d2b5bce2d0431d8` |
| Alembic head               | `0040_merge_gate2_heads`                                           |

## 2026-09-03 Gate 2 与增量复审

- Gate 2 Product Owner 签字位于 `reports/ui-refactor/gate-2/e3-product-owner-signoff.md`，原文时间为
  `2026-08-29T00:41:13+08:00`。Git blob OID 为 `f3faa981f2d164c7692045a73246f9d56846e71a`，
  规范化内容 SHA-256 为 `45152093ed5fa8c60d4ed03f2de73262b22780d82a040235a75b0223aba676f1`；
  签字内容在 `809054f..91a0269` 间没有变化。
- 增量审查范围固定为 `809054f30c908ee92210d538f3a1178e42bbcce9..91a02697e193c712c4e0aac7f9f4024daed93fe3`，
  只包含 PR [#228](https://github.com/greatLiverheat605/Logion/pull/228) 与
  [#229](https://github.com/greatLiverheat605/Logion/pull/229) 的 12 个文件。
- PR #228 提升 API/Web/Worker/Backup 最终镜像的 `libcrypto3/libssl3` 下限至 `3.5.8-r0`，并将既有
  `fast-uri` override/lockfile 一致升级到 `3.1.6`。PR #229 只改变 light tertiary text token 及测试基础设施：
  Audit 使用既有“至多一个 primary”合同，无 primary 时验证筛选 command bar/searchbox；Templates 直接验证真实
  `POST /templates/from-goal=201`，没有放宽 recent-auth 服务端语义。
- 独立只读审查结论：**PASS，P0=0 / P1=0 / P2=0 / P3=0，无 findings**。`packages/contracts`、
  API/OpenAPI、permission、sync、migration、数据库及 GLM manifest 均无 diff。
- 已知非阻塞残余：Nightly 的 `public-firefox` password-manager 测试首次运行 30 秒超时，retry #1 通过；
  该文件不在增量范围中，不作为本次结构回归。

## 2026-09-03 同 SHA 候选证据

- Main candidate [33732478569](https://github.com/greatLiverheat605/Logion/actions/runs/33732478569) 成功，
  `head_sha=91a02697e193c712c4e0aac7f9f4024daed93fe3`。`ci:fast`、生产许可证策略、不可变候选 smoke、
  四镜像 provenance、Trivy/CodeQL、SBOM 与 artifact 上传全部通过。
- candidate security summary 的 10 项 gate（四项 attestation、四项 image、filesystem、IaC）均为 passed；
  文件 SHA-256 为 `ddfbfb81c5f67e8677d00372b6e40994a854892def3a8365ced743657d860a55`。
- Nightly [33732517630](https://github.com/greatLiverheat605/Logion/actions/runs/33732517630) 成功并绑定同一 SHA；
  `ci:fast`、依赖审计、Compose、migration/空环境恢复和 Browser/PWA/WCAG 全部通过。浏览器结果为
  `178 passed / 12 skipped / 1 flaky / 0 failed`，Templates 在 session age `416s` 时创建响应为 `201`。
- Full capacity [33735531223](https://github.com/greatLiverheat605/Logion/actions/runs/33735531223) 成功并绑定同一 SHA；
  `errors=[]`，实际计数与预期完全一致：tasks `100000`、events `1000000`、notes/resources 各 `25000`、
  attachments `10000`、papers `5000`、AI runs `100000`。所有查询通过，最慢
  `notes_recent p95=5.291ms < 500ms`。
- capacity profile 明确保留 `production_equivalent_approved=false` 和生产式硬件/真实流量人工签字要求；
  Full capacity 通过不等于 Production 容量批准。
- candidate manifest 固定四个镜像 digest：
  - Web：`sha256:ad759bad950377c8e9bfd3ebfbea025a539e080eec1f0c3bfe6738af5a4fc08b`
  - API：`sha256:7db63c6f3506c79ffafce7fa415730d7d5d13e5e4d48bef38ceaac236b2d654a`
  - Worker：`sha256:893729e90b1513ed2796e0389381fff518abf573c0a387eb29eb420107286237`
  - Backup：`sha256:c35dbfe9153ff8e5bb635bc53d05f599290d97d3aeeb14e06276701806070281`
- compatibility 固定为 migration head `0040_merge_gate2_heads`、offline schema `4`、`sync-v1`；OpenAPI、
  pnpm lock 与 uv lock 均由 manifest hash 绑定。

## 已有参考证据

在本轮修复前，`origin/main=692abfa2f6e1aaae57655628dc8533ba62f0bbdf` 的 Main candidate workflow 已成功完成：

- Workflow：[#32463164818](https://github.com/greatLiverheat605/Logion/actions/runs/32463164818)
- Head SHA：`692abfa2f6e1aaae57655628dc8533ba62f0bbdf`
- 公开 artifact：`phase0-candidate-evidence-692abfa2f6e1aaae57655628dc8533ba62f0bbdf`
- 公开 artifact：`Logion-candidate.spdx.json`
- 公开 artifact：`candidate-security-692abfa2f6e1aaae57655628dc8533ba62f0bbdf`
- 四个镜像的精确 digest、manifest 内容、SBOM、provenance 和安全扫描摘要以 workflow artifact 为准；该旧候选不能替代修复后 RC8 的新证据。

## 本轮已完成的修复与验收

### Today 工作区切换竞态

- `TodayCenter` 为 context、Spaces 和本地数据读取增加取消、请求身份、当前 workspace 身份三重守卫。
- workspace 快速切换会立即清空旧 workspace 数据；迟到的 Spaces、IndexedDB 查询和异步解密结果不能写入新 workspace。
- 定向回归：`today-center.test.tsx`，`13 passed`。

### DELETE body 反向代理门

在一次性隔离 Docker 网络中使用仓库 Nginx 配置和 mock API 真实发送了两条脱敏 DELETE 请求：

- Definition delete：完整 JSON body 到达 API。
- Link delete：完整 JSON body 到达 API。
- 两条请求均保留 `Origin`、`X-CSRF-Token` 和 `Idempotency-Key`。
- 请求和响应仅在本机即时断言，未写入仓库、未访问生产；临时容器和网络已删除。
- 失败关闭规则保持有效：任一代理验收失败时，必须保持 `workbench_delete_api_enabled=false`，不得把字段降级到 query、URL 或未认证 fallback。

## PR 门禁结果

- PR：[#220](https://github.com/greatLiverheat605/Logion/pull/220)
- Implementation head：`fa8e119e355c8ab733b034e0b58eb21290326c9a`
- Final documentation head：`e252a9f9bbc8ecd2f6e847126b4ab661be708ec5`
- Checks run（实现 head）：[#32479408725](https://github.com/greatLiverheat605/Logion/actions/runs/32479408725)
- Checks run（最终文档 head）：[#32479814986](https://github.com/greatLiverheat605/Logion/actions/runs/32479814986)
- `fast`、`integration`、`browser`：success
- 该 run 只证明 PR head 的代码门禁，不等同于合并后的 Main candidate、Release candidate 或 Production 发布。

## RC8 必须补齐的证据

新候选提交后，必须把下列证据绑定到同一 source SHA：

1. Main candidate、Full capacity 和 Release candidate workflow 的成功 URL。
2. candidate manifest 及其 SHA-256。
3. Web、API、Worker、Backup 四个 digest-pinned 镜像的精确 digest。
4. SBOM、provenance attestation、许可证、秘密、依赖、IaC 和镜像安全扫描结果。
5. 数据库迁移 head、OpenAPI/锁文件兼容性和不可变镜像 smoke 结果。
6. 生产切换前备份点、备份校验、回滚目录/旧镜像/数据卷保留记录。
7. 至少 24 小时受控 prerelease 观察窗口、健康检查、错误率、重启/OOM、备份和告警结果。
8. GLM 对完整版本 diff 的只读复审结论：必须为 `PASS`，且 `P0=0 / P1=0`。

当前完成状态：第 1 项的 Main candidate/Full capacity 已完成，Release candidate 待触发；第 2～5 项的候选侧
证据已由 Main candidate artifact 核验；第 8 项已完成。第 6～7 项属于 RC8 生成并部署到受控 prerelease 后的
执行门，当前不得写成通过。

## 回滚约束

- 回滚顺序：关闭 flags，停止写入扩展能力，切换到不可变旧镜像或旧源码目录，保留旧镜像、旧源码、备份和数据卷。
- 不对非空数据库执行 downgrade，不以 downgrade 清理 Workbench 数据；`0039_workbench_foundation` 的降级保护必须保持生效。
- 回滚目录、备份和数据卷在观察窗口结束并完成新鲜批准前不得清理。
- 本候选未获得 Production 发布、流量切换或敏感能力启用授权。

## 当前阻塞项

- `0.2.0-rc8` Release candidate 尚未触发，完整 RC artifact 尚未生成。
- RC8 尚未部署到受控 prerelease；生产切换前备份、至少 24 小时观察、真实受邀邮件与实体移动设备验收未完成。
- `production_equivalent_approved=false`；生产式硬件与真实流量容量验证未获人工签字。
- Production 发布批准尚未申请，也未执行生产操作、流量切换、回滚点清理或敏感能力启用。
