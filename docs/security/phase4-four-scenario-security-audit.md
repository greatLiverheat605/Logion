# Phase 4 四场景安全审计

状态：L4-FINAL / Issue #107 候选审计

## 范围

覆盖 Phase 4 学习科学基础，以及 Exam、Self-study、Research、Collaboration 场景包；审查 REST、Sync Push/Pull/Bootstrap、离线 Vault、Workspace/Space 授权、审计元数据和动态用户上下文。不批准 Production，也不替代 Phase 6 的备份、真机、性能或可访问性门禁。

## 授权与披露矩阵

| 边界                 | Exam                     | Self-study | Research   | Collaboration              |
| -------------------- | ------------------------ | ---------- | ---------- | -------------------------- |
| 个人记录所有者       | 读写本人行               | 读写本人行 | 读写本人行 | 按角色读写共享数据         |
| Owner/Admin 读取他人 | 即使 Shared Space 也拒绝 | 同左       | 同左       | 可读取明确 Shared Space 行 |
| Reviewer             | 无个人可见权限           | 无         | 无         | 共享只读并只能追加反馈     |
| Viewer               | 无个人可见权限           | 无         | 无         | 共享只读                   |
| 其他 Workspace       | 隐藏                     | 隐藏       | 隐藏       | 隐藏                       |
| 他人的 Private Space | 隐藏                     | 隐藏       | 隐藏       | 禁止创建协作记录           |

每个请求均由服务端解析认证 membership 和 Space；个人场景另绑定 `user_id`，协作查询要求 `Space.visibility == "shared"`。客户端传入的 role、Workspace ownership 和 visibility 绝不作为授权结论。

## 攻击审查

| 威胁                                   | 控制与证据                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 猜测 UUID 在同步冲突中返回他人内容     | create 适配器在构建冲突投影前拒绝不同 `user_id`；`test_phase4_security_integration.py` 攻击 Exam、LearningTrack、PaperRecord、Rubric ID 并扫描受害者文本 |
| Owner 聚合私人学习状态                 | Exam/Self-study/Research REST 与 Pull/Bootstrap 测试断言隔离；场景报告服务不导入个人领域表                                                               |
| 协作报告静默抓取私人记录               | ReportSnapshot 只接收有界 summary 和同 Space ReviewRequest ID，不导入个人业务模型                                                                        |
| Viewer/Reviewer 修改共享结构           | CollaborationService 执行命名权限；Viewer 写和 Reviewer 量规/报告写均失败                                                                                |
| Private 协作记录进入同步               | REST/Sync 创建要求 Shared Space；Pull/Bootstrap 独立 join Space 并要求 `shared`                                                                          |
| IndexedDB 实体/Outbox 留明文           | 受保护仓库将 Phase 4 实体全部路由到 AES-256-GCM Vault；32 项持久行测试覆盖全部场景                                                                       |
| 敏感载荷进入审计/日志                  | 事件使用空/最小元数据；集成测试扫描考试、目标、证据、方法、反馈和报告文本                                                                                |
| AI 改正式掌握度、分数、Run、反馈或报告 | Phase 4 服务均未注册为 AI 写目标；正式记录需要认证人工 REST/Sync 操作                                                                                    |
| 用户特定上下文作为默认内容发布         | 生产路径 guard 拒绝命名教师/公司上下文；无 migration/seed 创建考试、课程、导师、小组、研究方向或日程                                                     |
| CSRF/不可信 Origin 写入                | 场景 REST 写和 Sync Push 均要求可信 Origin 与双提交 CSRF                                                                                                 |
| 依赖或 secret 泄露                     | 冻结依赖、PR CI 密钥扫描、`pnpm audit`、严格校验，Phase 4 无新增运行依赖                                                                                 |

## 迁移与协议兼容

迁移 0015–0022 为增量迁移并保留 UUID/Workspace/Space/version/audit 字段。Integration CI 执行空库升级、Alembic schema drift、完整降级/升级及从已有数据早期版本升级。同步实体类型在 `sync-v1` 下增量增加；受保护离线载荷沿用加密引用格式，不提升 IndexedDB schema。

## 残余风险

- 成员撤销前已同步的 Shared Space 内容可能留在设备；服务端只能阻止后续访问，不能擦除失控离线副本。
- 物理 Safari/iOS PWA 存储驱逐和后台执行仍需 Phase 6 真机验证；前台加密编辑/同步是当前权威路径。
- Phase 4 使用有界列表和保守记录级冲突。容量/性能及 CRDT/字段合并属于后续门禁，不引入静默覆盖。
- Report 是不可变应用记录，但还不是公开 token 化 ShareSnapshot；公开分享与撤销属于 Phase 5。
