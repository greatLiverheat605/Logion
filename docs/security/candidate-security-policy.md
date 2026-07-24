# 候选产物安全与依赖策略

## 阻塞策略

候选身份由完整 source commit 和四个 `repository@sha256:digest` 引用构成。Main 在扫描前针对本仓库验证每份 GitHub attestation；可变 tag、服务集合不完整和 digest 不匹配在工具运行前即拒绝。

运行镜像使用明确、仍受支持的 patch/distribution tag。首轮镜像门禁发现旧 Debian 运行时仍有未解决基础 OS 问题后，Python 服务改用 Alpine 3.24。独立 Next 服务运行时不用包管理工具，Web 镜像移除 npm/npx。Backup 跟随当前 PostgreSQL 17 minor Alpine 镜像，并移除继承的 `gosu`，因为覆盖后的 entrypoint 已以 `postgres` 运行且不切换用户。基础镜像修复不改变冻结应用锁文件。

阻塞发布的检查：

- 任一候选镜像包含 HIGH/CRITICAL OS 或库漏洞；
- 镜像或仓库文件系统检测到 secret；
- IaC/Dockerfile 出现 HIGH/CRITICAL 配置发现；
- GitHub/Sigstore provenance 缺失或无效；
- 生产依赖许可证为 UNKNOWN 或未批准；
- PR 已强制的源码依赖/secret 扫描失败。

封装器即使一项失败也会完成全部独立检查并写 `candidate-security-summary.json`。SARIF 上传 GitHub code scanning，完整安全产物保留 90 天。报告可含包名、版本、许可证、digest 和发现，不得含环境 dump、凭据、Cookie 或用户内容。

## 许可证决定

`config/security/license-policy.json` 是可审查白名单。在项目所有者选定并发布仓库许可证前，Logion 内部包记为 `INTERNAL`。Python 许可证表达式缺失时，只可从已安装包的 OSI classifier 映射；未知元数据失败关闭。

当前依赖图允许宽松许可证、MPL-2.0、CC-BY-4.0 及当前 Sharp 二进制表达式。这是工程兼容门禁，不构成法律意见；署名、NOTICE、LGPL 替换/重新链接和源码提供义务仍是发布清单项。

## 例外与响应

L6-002 不存在静默 ignore 文件。被阻塞候选保留并标记拒绝；修复顺序为升级依赖/基础镜像、移除或配置修正。若没有修复，人类安全负责人必须先建立单独审查、限时例外，写明受影响 digest/CVE 或规则、暴露分析、补偿控制、Owner 和到期日，策略才能增加例外支持。不能从例外推导 Production 批准。
