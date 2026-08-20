# I3-C6 Schema/409 合同修正门

> 状态：Product Owner 已批准施工，待独立复审与协调方验收。
> 基线：`8223af16ea587196d4e75bf26a665abc4fc7755c`。
> 目的：修复 C6-S1 发现的 Schema 硬限制缺口与 409 运行时/生成合同分叉；不实现路由、服务、持久化或生产开关。

## 1. 修正范围

本门不改变 C3/C4/C6-Q0 的数值或业务权限，只把已批准规则落实到单一 Schema 事实源：

- `WorkbenchDefinitionDocumentV1` canonical RFC 8785 UTF-8 上限为 32 KiB；
- `WorkbenchLinkMutableV1` canonical RFC 8785 UTF-8 上限为 2 KiB；
- Definition 的 module/filter/quick-create/field/option ID 唯一，引用完整；
- layout 恰好覆盖全部 module，同 region 的 order 唯一，`span <= columns`；
- `attribute-equals` 的 field 存在且 value 匹配注册字段类型；
- integer/boolean 严格类型、number/rating 边界、枚举数组唯一、PlainText 标量与 UTF-8 字节边界按 C3 执行；
- Preference 的隐藏列表/排序列表在运行时保持唯一，并继续强制 `fixed.learning` 不可隐藏且必须出现在排序中；
- `WorkbenchConflictDetails` 的生成合同和运行时统一使用 camelCase：`baseRevision`、`remoteRevision`、`conflictPaths`。

原始 JSON 的 UTF-8/BOM、重复键、危险键、非有限数字 token、递归深度和 endpoint 原始 body 上限仍由 C6-A 的有界 duplicate-aware parser 在进入 Pydantic 前执行。C6-A 只能调用本门 Schema，不得复制 Definition/Link 结构规则或 32 KiB/2 KiB 常量。

## 2. Lifecycle 409 修正

Definition replace 与 Link 三方合并冲突继续使用完整 `WorkbenchConflictDetails`，其中 `base`/`local` 只回显请求中已通过 Schema 的合并上下文。

`WorkbenchConflictDetails` 按 `entity` 建模为三个严格变体：`definition` 的三方值只能是 Definition document，`link` 的三方值只能是 Link mutable，`link_set` 的三方值是最多 500 个、各自唯一的 Link UUID 顺序快照。三种值不得混用；link-set 快照只表达 ID 与顺序，不包含目标正文、成员或 ACL。

409 错误外壳同时按 `code` 严格区分：`WORKBENCH_VERSION_CONFLICT` 可携带上述三方详情或 lifecycle 使用的空详情，`WORKBENCH_IDEMPOTENCY_CONFLICT` 只能携带空详情；两者的五个根字段均为必需字段。

Archive/restore 请求只有 `expectedRevision` 与 `baseLifecycle`，没有 Definition `base`/`local` 文档。其 revision 冲突必须返回：

```json
{
  "code": "WORKBENCH_VERSION_CONFLICT",
  "message": "The Workbench changed after it was read.",
  "details": {},
  "retryable": false,
  "request_id": "request-id"
}
```

客户端收到该响应后重新读取 Definition，再由用户发起新的 lifecycle 操作。服务端不得把当前 document 复制为虚假的 `base`/`local`，也不得泄露远端 document、配额或权限信息。

本节是对 C3 §9 “所有 version conflict 都有三方上下文”的窄化修正：只有请求本身携带合法三方合并上下文的操作才能返回 `WorkbenchConflictDetails`；无合并上下文的 lifecycle 冲突使用已存在的 `WorkbenchEmptyDetails`。

## 3. 非目标与停止条件

非目标：不修改 C6-S1 Service/Repository，不实现 Link registry、API routes、限流、cursor、ETag、import/export/delete，不修改 migration/DDL，不启用 Feature Flag。

停止条件：

- 需要在 Service 或 C6-A 中复制 Schema 数值/结构规则；
- 生成 OpenAPI 与 Pydantic `by_alias=True` 仍不一致；
- 合法 Definition 无法达到 C3 冻结的最深结构，或 32 KiB/2 KiB 精确边界不稳定；
- 任何现有非 Workbench API 合同发生变化。

## 4. 验收门

- Definition/Link 精确字节边界、唯一性、引用、layout、字段值与 409 alias 负测；
- Workbench OpenAPI 合同测试与 contracts generate/check；
- API Ruff、mypy、Prettier、pytest；
- 生成 diff 仅限批准的 Workbench Schema/类型变化；
- 独立只读对抗复审无 P0/P1。
