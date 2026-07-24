# Phase 2 阶段验收记录

- 评审日期：2026-07-21
- 基线：`LOGION_EXECUTION_PLAN.md`、`LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`
- Main 候选：`2b9c391`
- 候选证据：<https://github.com/greatLiverheat605/Logion/actions/runs/29813886725>
- 结论：可进入一次 Phase 2 人工批准；无已知 P0/P1 缺陷

## 交付链

| 工作包                    | Main commit                     | 交付证据                                                           |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| sync-v1 契约/运行校验     | `63203e8`, `09a5dd5`, `166ea19` | 严格 schema、生成类型/校验器、RFC 8785 checksum vectors            |
| IndexedDB/原子 Outbox     | `0a1fba3`                       | entity+operation 事务、依赖排序、Workspace/device 隔离             |
| 可续传 Bootstrap          | `db55612`                       | staging、重放、checksum、原子激活、epoch 隔离、v1 升级             |
| 服务端账本/Push           | `d71fc2e`, `caf1c07`            | PostgreSQL 约束/trigger、幂等、部分成功、Space adapter             |
| Pull/Bootstrap/客户端循环 | `f00dbc1`                       | cursor page、保留/epoch 控制、Private Space 过滤、客户端事务       |
| 冲突/附件/Vault/UI        | `2b9c391`                       | IndexedDB v3、显式解决、Blob 校验队列、AES-GCM Vault、残留数据提示 |

## 阻塞风险矩阵

| 风险                         | 结果                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| 重复/重放 operation          | 同 identity 返回原 sequence/version；Hash/context 变化失败关闭 |
| 部分 batch/依赖失败          | 有序 applied/rejected/blocked，每 operation 使用 savepoint     |
| 弱网/中断                    | Outbox 保持 pending，cursor 不前移                             |
| 本地 mutation/Bootstrap 崩溃 | IndexedDB 事务绑定实体/Outbox 和激活/cursor，升级中断测试通过  |
| epoch 变化/恢复              | 明确 rebootstrap，激活时隔离旧 Outbox                          |
| cursor 过期                  | 明确 cursor-expired，不能空成功                                |
| 租户/Private Space 隔离      | 路径/信封/device 一致、active membership、shared-or-owner 读取 |
| device 撤销/残留数据         | 撤销会话拒绝，本地 Vault 锁定，可显式事务 wipe                 |
| 静默冲突覆盖                 | pending 实体标记 conflict，双版本保留到用户选择                |
| 附件滥用                     | path、extension、MIME、magic/text、20 MB、SHA-256 校验         |
| 离线静态数据                 | PBKDF2-SHA-256 + 不可导出 AES-256-GCM，每记录 IV/AAD           |
| 依赖/secret                  | `pnpm audit --prod`、`pip-audit` 及仓库 secret scan 无发现     |

所有工作包 Fast/Integration 均通过。最终 Main 候选从干净 `main` 通过迁移、PostgreSQL、Redis、生成契约、Python/TypeScript、单元/集成、构建、依赖审计和策略 guard。

## 兼容与残余风险

- IndexedDB 支持 v1/v2→v3；旧客户端失败关闭，禁止降级，恢复需兼容客户端后 Bootstrap。
- 无 IndexedDB/WebCrypto 的浏览器失败关闭且保留服务端访问，不能宣传完整离线能力。
- 物理 Safari/iOS PWA 后台调度、存储驱逐和安装模式留待 RC 真机；前台重开执行同一可续传循环。
- 服务端撤销无法擦除始终离线浏览器，UI 明示并提供本地 wipe。
- Phase 2 只同步 Space 元数据；Phase 3 的笔记/研究正文必须进入 `vaultRecords`，禁止明文。

## 人工批准清单

1. 交付范围符合离线/同步基础目标。
2. iOS/Safari 真机项可留到 RC。
3. 接受只能前向 IndexedDB 迁移和明确本地 wipe 语义。
4. 本批准不代表 Production 发布。
