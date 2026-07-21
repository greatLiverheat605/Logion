# 离线存储威胁模型

- 工作包：`L2-001A`、`L2-002A`
- 当前范围：IndexedDB v2、本地实体、Outbox、Bootstrap staging/原子切换和公开错误边界
- 权威输入：根目录两份基线与已冻结 `sync-v1`

## 信任边界与数据寿命

浏览器 IndexedDB 是已登录用户的本地工作副本，不是服务端授权来源。数据库按稳定 User UUID 分库，所有实体、Outbox 和同步状态仍带 `workspace_id`；切换账户不能复用另一账户的数据库实例。Cookie、Access/Refresh Token、TOTP/恢复码、Provider 密钥和邀请令牌禁止写入离线库。

本地实体可能包含私人笔记和研究内容。`L2-001A` 尚未提供本地解锁和静态加密，因此只建立可被后续加密适配器包裹的 repository 边界；在 Phase 2 关闭前，必须完成本地解锁、密钥生命周期、退出/撤销后的残留提示与浏览器降级验证。当前实现不能作为共享或不受信任设备上的数据保密承诺。

## 威胁、控制与验证

| 威胁                             | 当前控制                                                                       | 验证                                  |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| 业务实体已写但 Outbox 丢失       | 两张表在单一 Dexie `rw` 事务提交                                               | Outbox hook 注入失败后两表均为空      |
| 同一 operation 被重复提交        | 同 ID、同 Hash/元数据返回 duplicate，不重复写                                  | 重复提交测试                          |
| 同一 ID 被换 Payload 或元数据    | Hash 或身份/版本/依赖不一致失败关闭                                            | 篡改 Hash 测试                        |
| 跨 workspace/device/entity 混淆  | Repository 从一个校验后的输入同时构造实体和 operation，不接收两套租户字段      | 类型与输入负测；L2-003 再做服务端矩阵 |
| 旧编辑覆盖新本地编辑             | create/update/delete/restore 校验本地 revision、server base version 与创建信息 | 非法状态迁移测试                      |
| 删除操作继续携带正文             | delete 只接受空 Payload，正文留在本地实体直到服务端 tombstone 流程处理         | 删除 Payload 负测                     |
| Payload 造成循环、深度或内存滥用 | 只接受有限 JSON；深度 20、顶层 200 字段、默认 canonical bytes 256 KiB          | 验证与大小测试                        |
| Outbox 依赖乱序或绕过阻塞        | 待发送列表做拓扑排序；依赖 blocked/conflict/isolated/in-flight 时不发送后继    | 顺序与阻塞测试                        |
| 新应用 schema 被旧代码写坏       | IndexedDB `VersionError` 映射为 upgrade-required，旧代码不自动删除数据库       | future schema 测试                    |
| 错误或日志泄露 Payload           | `OfflineStorageError` 只序列化 code/retryable；库内无 console/log 调用         | 静态审查                              |
| 伪造或损坏的快照进入可见数据     | 运行时 schema、context、记录/块/总 Hash 和实体唯一性全部通过后才原子切换       | 格式、Hash、重复与跨 context 负测     |
| 中断、配额或崩溃造成半份快照     | chunk 仅写 staging；最终实体/cursor/epoch/清理在一个事务提交                   | reopen、staging/activation 配额注入   |
| epoch 恢复后重放旧编辑           | 同一最终事务隔离当前设备 Outbox，移除旧 overlay，保留 operation 供人工处理     | epoch 切换与回滚测试                  |
| 超大快照放大 Hash/内存消耗       | 先检查 canonical chunk 字节上限，再核对逐记录 Hash；总 Hash 只处理 chunk 清单  | 大小上限与固定 manifest framing       |

## 仍需在 Phase 2 关闭前完成

- 本地解锁、数据密钥包装、锁定/退出/撤销策略及恢复方式；
- 隔离 Outbox 的用户可见导出、冲突中心和保留策略；
- 服务端租户/设备/角色授权、operation 幂等表和变更日志；
- 浏览器真实配额、Safari/iOS PWA、崩溃点和多设备故障注入。

上述项目不是可豁免风险；任一数据丢失、静默覆盖或跨租户泄露均阻止 Phase 2 关闭。
