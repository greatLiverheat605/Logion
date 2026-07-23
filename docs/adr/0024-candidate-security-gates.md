# ADR 0024: 候选安全门禁绑定 digest 并失败关闭

- 状态：Accepted
- 日期：2026-07-23
- 范围：Phase 6 / L6-002

## 决策

Main 对候选清单中的 Web、API、Worker 和 Backup 完整 digest 逐一验证 GitHub/Sigstore provenance，并使用固定版本 Trivy 扫描镜像的 HIGH/CRITICAL 漏洞和秘密、仓库依赖/秘密以及 IaC HIGH/CRITICAL 配置缺陷。所有子检查都执行并生成独立 SARIF；任一失败使候选失败，但不删除已生成的不可变镜像。

PR、Main 和 Nightly 对生产 Node/Python 依赖执行同一许可证策略。未知许可证、未在策略中批准的表达式或缺失证据失败关闭。策略变更必须经安全和许可证复核，不允许在工作流中临时 `ignore`。扫描报告按源码 SHA、镜像 digest 和候选清单关联，安全报告保留 90 天。

## 理由

扫描源码不能发现基础镜像和最终安装层中的漏洞；扫描 SHA tag 仍可能与实际晋级 digest 脱节。只在 Nightly 发现许可证或供应链问题又会允许已知不合规候选进入 RC。逐 digest 验证和仓库内可复现入口使失败可以被审计和重跑。

## 后果

- 新披露的 HIGH/CRITICAL 漏洞可能阻断 Main 候选，即使没有上游修复；是否接受残余风险必须由人类通过后续有期限、可审计的例外流程决定。
- `Apache-2.0 AND LGPL-3.0-or-later` 和 `CC-BY-4.0` 被允许不代表免除归属、NOTICE、可替换链接或源代码提供义务；正式分发前仍需法律/许可证复核。
- 安全扫描成功不代表生产批准，也不替代租户越权、恢复、浏览器、WCAG 和真实灰度验证。
