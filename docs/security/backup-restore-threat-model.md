# 备份恢复威胁模型

日期：2026-07-23  
范围：Phase 5 / L5-023，Phase 6 / L6-003

| 威胁                                  | 控制                                                                                            | 验证                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| 数据库/附件备份泄漏                   | AES-256-GCM；key 仅从只读 mounted secret 读取；bundle 不含 key                                  | 密文无明文标记、错误 key/tag 失败测试 |
| key 进入 image、环境、命令行或日志    | Compose secret file；crypto 工具只接收 key path；manifest 仅含非秘密 key ID                     | image/config/log 审查                 |
| 密文截断、篡改或 sidecar 错配         | SHA-256 sidecar + GCM authentication；临时文件完成后原子 rename                                 | tamper 单元测试与 nightly verify      |
| tar 路径穿越、symlink/device 覆盖宿主 | member 数量限制；规范路径和顶层 allowlist；拒绝 `..`、absolute、link/device；Python data filter | 恶意 archive 单元测试                 |
| 恢复覆盖生产或错误数据库              | 数据库名字符白名单；目标必须无业务表；附件目标必须为空且位于 `/tmp`/`/restore`                  | negative script test 与人工 runbook   |
| 只恢复数据库、遗漏附件/版本           | 单一加密 bundle；manifest 明确 contents/version；nightly marker 和 migration 比对               | nightly empty restore                 |
| 恢复后旧设备污染数据                  | restore helper 无条件更新所有 workspace `sync_epoch`                                            | source/restored epoch 不同断言        |
| 同机卷同时丢失                        | 文档和发布门槛要求独立账户/区域 immutable copy；同机副本不宣称灾备                              | Phase 6 provider 演练与告警证据       |
| key 轮换导致旧备份不可读              | 文件名和 manifest 记录 key ID；旧 key 保留至最长 retention 并抽样验证                           | key-generation 恢复矩阵               |
| 清理命令误删非备份路径                | retention 只匹配 `/backups/logion-*.backup{,.sha256}`；临时目录固定在 `/tmp`                    | shell 审查与容器只读文件系统          |
| RC 用未审核或可变 Backup 镜像恢复     | RC 只接受成功 Main run 的候选 manifest；恢复脚本拒绝非 `@sha256` 的 Backup 引用                 | Main run 校验、manifest 校验、RC JSON |
| 恢复报告被误当成生产批准              | JSON 明列人工复核项；工作流只使用 staging 环境且不包含 production 写权限                        | environment/permission 审查           |

残余风险：自动化 RC 证明候选镜像能在隔离空环境恢复并强制更换 sync epoch，但云端异地复制、WORM 保留、密钥托管服务、物理灾难和季度生产等价演练取决于最终云平台，仍是发布阻断项，不能用本地 volume 或 CI 临时环境代替。
