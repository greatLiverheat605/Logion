# V20-15 RC8 修复候选与发布证据

> 更新时间：2026-08-21（Asia/Shanghai）。
> 本文件是 RC8 进入发布门禁前的证据索引，不代表候选已发布、已部署或已获得 Production 授权。

## 当前结论

- RC7 仍是受控 prerelease 的运行版本；本轮 C7 修复尚未替换线上版本。
- `workbench_delete_api_enabled` 与其它敏感 Workbench 能力继续默认关闭；本轮没有启用删除路由、生产 flag、生产凭据或生产访问。
- C7 修复实现提交为 `fa8e119e355c8ab733b034e0b58eb21290326c9a`；PR #220 的 `fast`、`integration`、`browser` 已在 run `32479408725` 成功。合并后仍必须以新的 `main` SHA 重新生成 Main candidate、容量、镜像、SBOM、provenance 和 Release candidate 证据，不能复用旧候选作为 RC8 发布证明。
- 只有 GLM 对完整版本变更返回 `PASS` 且 `P0=0 / P1=0`，并由协调方复核后，才可向用户申请 Production 发布批准。

## 修复候选身份

当前工作树基于 `origin/main=692abfa2f6e1aaae57655628dc8533ba62f0bbdf` 的直接修复分支。TodayCenter 修复、依赖安全锁定和文档更新已形成 PR 候选；最终 RC8 source SHA 仍须在合并到 `main` 后固定，不能把 feature branch SHA 冒充 RC8：

| 字段                       | 状态                                       |
| -------------------------- | ------------------------------------------ |
| C7 修复实现提交            | `fa8e119e355c8ab733b034e0b58eb21290326c9a` |
| RC8 产品源码 SHA           | 待合并到 `main` 后固定                     |
| Main candidate             | 待新 SHA 触发                              |
| Full capacity              | 待新 SHA 触发                              |
| Release candidate          | 待新 SHA 触发                              |
| Candidate manifest SHA-256 | 待 artifact 下载并核验                     |
| Alembic head               | 以新 manifest 为准                         |

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
- Head：`fa8e119e355c8ab733b034e0b58eb21290326c9a`
- Checks run：[#32479408725](https://github.com/greatLiverheat605/Logion/actions/runs/32479408725)
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

## 回滚约束

- 回滚顺序：关闭 flags，停止写入扩展能力，切换到不可变旧镜像或旧源码目录，保留旧镜像、旧源码、备份和数据卷。
- 不对非空数据库执行 downgrade，不以 downgrade 清理 Workbench 数据；`0039_workbench_foundation` 的降级保护必须保持生效。
- 回滚目录、备份和数据卷在观察窗口结束并完成新鲜批准前不得清理。
- 本候选未获得 Production 发布、流量切换或敏感能力启用授权。

## 当前阻塞项

- 新 SHA 尚未提交并触发 RC8 candidate workflow。
- 新候选尚未完成完整 Release candidate 证据归档。
- GLM 修复后整体只读复审尚未返回 `PASS / P0=0 / P1=0`。
- Production 发布批准尚未申请，也未执行生产操作。
