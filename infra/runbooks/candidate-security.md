# 候选产物安全门禁操作手册

## 复现许可证门禁

冻结依赖安装后执行：

```sh
mkdir -p reports/security
pnpm licenses list --json --prod > reports/security/pnpm-licenses.json
uv run --isolated --no-dev --all-packages python scripts/security/license_policy.py \
  --policy config/security/license-policy.json \
  --pnpm-json reports/security/pnpm-licenses.json \
  --output reports/security/license-policy.json
rm reports/security/pnpm-licenses.json
```

审查规范化报告，特别是 `denied`，无需保留包管理器路径。

## 复现候选扫描

认证 `gh`、Trivy 和容器仓库时不得打印 token。从已验证候选 manifest 提供四个精确引用：

```sh
python scripts/security/candidate_security.py \
  --repository OWNER/REPOSITORY \
  --reports-dir reports/security \
  --verify-attestations \
  --image web=REGISTRY/WEB@sha256:DIGEST \
  --image api=REGISTRY/API@sha256:DIGEST \
  --image worker=REGISTRY/WORKER@sha256:DIGEST \
  --image backup=REGISTRY/BACKUP@sha256:DIGEST
```

命令会尝试全部来源、镜像、文件系统和 IaC 检查，任一失败即非零退出。不得针对 tag 重跑，也不得编辑生成摘要。

## 分类处置

1. 阅读发现前确认 source SHA、manifest 和 digest。
2. 漏洞：确认受影响层/包、可利用性和修复版本；从新 commit 重建，绝不替换旧 digest。
3. 密钥：先撤销，再从完整 Git 历史移除并重建；检测器输出按敏感信息处理。
4. IaC：修复仓库声明，并另行验证有效部署。
5. 许可证拒绝：验证上游元数据和义务；策略修改须人工审查。
6. 保留失败产物，将修复关联到其 Main run。无源码变化的重跑只能确认临时基础设施故障，不能改变有漏洞的字节。
