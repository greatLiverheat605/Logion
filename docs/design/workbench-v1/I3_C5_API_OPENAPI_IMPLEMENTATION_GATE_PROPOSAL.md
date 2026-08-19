# I3-C5 API/OpenAPI 合同实现与候选生成门提案

状态：Proposed，仅供 API、OpenAPI、安全与 Product Owner 评审  
日期：2026-08-19  
前置批准：[I3-C4 API/OpenAPI 合同提案](./I3_C4_API_OPENAPI_CONTRACT_PROPOSAL.md) 已通过独立只读复审  
当前基线：`codex/product-workbench-v1-spec` / `4d538645305d72dcc8a9c67de6d973743a3fb018`

本门只实现合同形状、路由注册边界和候选 OpenAPI 生成，不实现 Workbench 持久化或正式数据路径。默认应用继续关闭能力；任何数据库、迁移、配额、威胁模型、生产配置、前端保存和部署动作均属于后续独立门。

## 1. 目标与不可变边界

本门必须证明：

- C4 定义的 **10 个绝对 API path、15 个 operation** 能由仓库现有 FastAPI/Pydantic/OpenAPI 生成链产生；数量不符立即失败；
- 默认 `create_app()` 不注册这些路由，访问结果与未知路径一致，不触碰 Session、CSRF、限流、数据库或资源解析；
- 仅进程内 dormant exporter 能生成精确 10 path、15 operationId 的候选合同，不启动服务、不连接数据库、不执行 mutation；
- 旧 paths、operationId、参数、responses、security、UserSetting、ErrorResponse、persona、sync-v1、Vault/Outbox 语义零变化；
- generated `packages/contracts` 只产生批准的加法，第二次生成工作树无差异。

本门明确不做：

- 不建立 Definition、Link、receipt 或幂等表，不修改 SQLAlchemy model，不写 migration/DDL；
- 不实现真实 create/replace/delete/import、typed target ACL、配额、durable journal 或 Preference 持久化；
- 不增加或修改生产 `.env`、Compose/Kubernetes、反向代理、密钥、Feature Flag 默认值或部署脚本；
- 不修改 Web、SessionBoundary、Persona 设置服务、Workspace/Space 服务或正式对象 API；
- 不提交、推送、合并、部署，也不读取生产数据。

C5-A 不得在当前含既有 Web/文档修改的工作树施工。设计门批准并形成可达 Git 基线后，协调方必须从该精确 SHA 创建一个新的干净隔离 worktree；开始时 `git status --porcelain=v1 --untracked-files=all` 必须为空。记录 HEAD、全部 tracked 文件的 mode/blob SHA、submodule SHA 和空的 untracked 清单；此后每个门禁都比较“开始快照 -> 当前状态”的增量，只有第 2 节白名单和明确允许机械触及但 hash 不变的文件可以变化。不能取得干净隔离 worktree 时立即停止，不允许在当前 dirty 工作树用相对 HEAD 的 diff 冒充边界证明。

开始快照必须按以下 PowerShell 命令执行（所有命令期望退出码 `0`；任一步失败立即停止；证据目录位于系统临时目录，不进入 Git）：

```powershell
$C5Base = "4d538645305d72dcc8a9c67de6d973743a3fb018"
$C5Worktree = Join-Path $env:TEMP "logion-workbench-v1-c5-a"
$C5Evidence = Join-Path $env:TEMP "logion-workbench-v1-c5-a-evidence"
git worktree add --detach $C5Worktree $C5Base
Set-Location $C5Worktree
New-Item -ItemType Directory -Force $C5Evidence | Out-Null
git rev-parse HEAD | Set-Content "$C5Evidence\head.before.txt"
New-Item -ItemType File -Force "$C5Evidence\status.before.txt" | Out-Null
git status --porcelain=v1 --untracked-files=all | Add-Content "$C5Evidence\status.before.txt"
if ((Get-Item "$C5Evidence\status.before.txt").Length -ne 0) { throw "C5-A worktree is not clean" }
git ls-files -s | Set-Content "$C5Evidence\tracked-mode-blob.before.txt"
New-Item -ItemType File -Force "$C5Evidence\submodules.before.txt" | Out-Null
git submodule status --recursive | Add-Content "$C5Evidence\submodules.before.txt"
New-Item -ItemType File -Force "$C5Evidence\untracked.before.txt" | Out-Null
git ls-files --others --exclude-standard | Add-Content "$C5Evidence\untracked.before.txt"
Copy-Item packages/contracts/openapi/openapi.json "$C5Evidence\openapi.before.json"
@("packages/contracts/src/sync-v1.ts","packages/contracts/src/sync-v1-validator.generated.js","packages/contracts/src/sync-v1-validator.generated.d.ts") | Get-FileHash -Algorithm SHA256 | ConvertTo-Json | Set-Content "$C5Evidence\sync.hash.before.json"
```

结束时必须运行以下边界断言（所有断言期望退出码 `0`）：

```powershell
$Allowed = @(
  "apps/api/src/logion_api/workbenches/__init__.py",
  "apps/api/src/logion_api/workbenches/schemas.py",
  "apps/api/src/logion_api/workbenches/contract_routes.py",
  "apps/api/src/logion_api/openapi_export.py",
  "apps/api/src/logion_api/main.py",
  "apps/api/tests/test_workbench_openapi_contract.py",
  "apps/api/tests/test_workbench_route_disabled.py",
  "packages/contracts/openapi/openapi.json",
  "packages/contracts/src/openapi.d.ts",
  "packages/contracts/src/sync-v1.ts",
  "packages/contracts/src/sync-v1-validator.generated.js",
  "packages/contracts/src/sync-v1-validator.generated.d.ts"
)
New-Item -ItemType File -Force "$C5Evidence\status.after.txt" | Out-Null
git status --porcelain=v1 --untracked-files=all | Add-Content "$C5Evidence\status.after.txt"
$Changed = @(git diff --name-only) + @(git ls-files --others --exclude-standard)
$Unexpected = @($Changed | Where-Object { $_ -and ($_ -notin $Allowed) })
if ($Unexpected.Count -ne 0) { $Unexpected; throw "C5-A changed a path outside the allowlist" }
function Get-NonAllowedTrackedEntries([string[]]$Entries, [string[]]$AllowedPaths) {
  @($Entries | Where-Object {
    $path = ($_ -split "`t", 2)[1]
    $path -and ($path -notin $AllowedPaths)
  })
}
$BeforeNonAllowedTracked = Get-NonAllowedTrackedEntries (Get-Content "$C5Evidence\tracked-mode-blob.before.txt") $Allowed
$AfterNonAllowedTracked = Get-NonAllowedTrackedEntries @(git ls-files -s) $Allowed
if ((Compare-Object $BeforeNonAllowedTracked $AfterNonAllowedTracked) -ne $null) { throw "non-allowlisted tracked mode/blob changed" }
if ((Compare-Object (Get-Content "$C5Evidence\submodules.before.txt") (git submodule status --recursive)) -ne $null) { throw "submodule state changed" }
```

证据文件必须保留 `head.before.txt`、`status.before.txt`、`status.after.txt`、`tracked-mode-blob.before.txt`、`submodules.before.txt`、`untracked.before.txt` 和对应 hash/semantic/pytest 产物。

## 2. 严格写入白名单

实施方只能产生下列**内容差异**；新增文件必须精确匹配清单，不允许目录通配：

```text
apps/api/src/logion_api/workbenches/__init__.py
apps/api/src/logion_api/workbenches/schemas.py
apps/api/src/logion_api/workbenches/contract_routes.py
apps/api/src/logion_api/openapi_export.py
apps/api/src/logion_api/main.py
apps/api/tests/test_workbench_openapi_contract.py
apps/api/tests/test_workbench_route_disabled.py
packages/contracts/openapi/openapi.json          # 仅由生成器产生
packages/contracts/src/openapi.d.ts               # 仅由生成器产生
```

`main.py` 只允许三类可审查变化：导入 `contract_router`、给 `create_app()` 增加 keyword-only `include_dormant_contracts: bool = False`、在现有 router 序列末端增加单个条件 `include_router`。实施前保存 `main.py` AST 结构 manifest；测试必须删除上述三个批准节点后与基线 AST 完全相同，并由人工逐行 diff 复核中间件、异常处理器、旧 router 导入/include 次序零变化。default OpenAPI manifest 只负责旧 HTTP 合同零漂移，不能替代该结构核对。该参数不得从 HTTP、UserSetting 或生产环境变量读取。

根命令 `pnpm contracts:generate` 与 `pnpm contracts:check` 会机械重写以下 sync-v1 生成文件；它们不是批准的内容差异，但允许生成器执行写入，前后 SHA-256 必须逐项相同，最终不得出现在 `git diff`：

```text
packages/contracts/src/sync-v1.ts
packages/contracts/src/sync-v1-validator.generated.js
packages/contracts/src/sync-v1-validator.generated.d.ts
```

实施前保存三文件 hash；每次生成后复核。任何字节变化立即停止，禁止把它们加入白名单或通过格式化掩盖。除上述“允许差异”和“机械触及但零差异”文件外，任何写入都必须停止并重新申请范围。

禁止写入：

```text
apps/api/migrations/**
apps/api/src/**/models.py
apps/api/src/logion_api/config.py
apps/api/src/logion_api/users/**
apps/api/src/logion_api/workspaces/**
apps/api/src/logion_api/memory/**
apps/api/src/logion_api/sync/**
apps/web/**
packages/offline/**
docker/**  .env*  compose*  nginx*  Caddyfile*
```

此外，`workbenches` 三个源码文件与 `openapi_export.py` 全部进入 AST/import/call 扫描。它们禁止导入或动态加载 `sqlalchemy`、数据库/session dependencies、repository/model、HTTP/网络客户端、Workspace/Space/正式对象 service、UserSetting service、限流器、任务队列、生产配置、`subprocess`、`socket` 或动态 import 工具。`main.py` 的既有导入不纳入该禁令，但其增量仍只允许上文三个 AST 节点。

`openapi_export.py` 的新增增量只允许标准库 `json`、`sys`、`pathlib.Path` 与 `logion_api.main.create_app`。仓库现有 `main.py` 的 module-level `app = create_app()` 是 ASGI 入口基线初始化：导入模块时允许它按既有路径读取 Settings 并构造一次默认 app，但不得产生数据库、网络或文件写入；这项既有初始化必须单独计数，不能误报为 exporter 的 dormant 构造。exporter 函数自身只允许额外调用一次 `create_app(include_dormant_contracts=True)`、该 dormant app 的 `openapi()`、JSON 序列化，以及对命令行唯一输出目标的父目录 `mkdir` 和文件 `write_text`。C5-A 中该目标必须精确解析为 `packages/contracts/openapi/openapi.json`；禁止 exporter 函数直接读取环境变量或写入其他文件、数据库、网络、进程或日志正文。测试在导入 exporter 前 patch `subprocess`、`socket` 和通用文件 mutation，并分别断言：基线 app 初始化只发生一次且仍为默认参数；exporter 只额外构造一个 `include_dormant_contracts=True` app；仅白名单输出路径的 `mkdir/write_text` 被放行；endpoint 请求没有构造或调用 DB、Session、CSRF、限流、网络与 mutation service。若必须移除、延迟或改变 module-level `app` 初始化，立即停止并重新申请范围。出现禁止 import/call 或额外写入即失败，不能依赖“测试未走到该分支”。

## 3. 合同实现方式

### 3.1 Schema 来源

`workbenches/schemas.py` 只定义 C4/C3 已批准的 Pydantic 请求、响应、Header 和错误变体：

- 普通对象 `extra="forbid"`；受控字典使用 property names 与 typed values；
- union 使用显式 discriminator、互斥 `oneOf`；UUID、长度、范围、`maxItems`、`uniqueItems`、nullable 和 required 必须进入 OpenAPI；
- 客户端请求不得出现 owner、服务端 ID、revision、lifecycle、Workspace/Space、Role、ACL、审计或配置开关字段；
- 不以 `dict[str, Any]` 或无界 `object` 代替 C3 已冻结的模块、target、reference 和 attribute 结构；
- import/export 复用 C3 的便携文档类型，不复制第二份 canonicalization 或安全字段定义。

### 3.2 路由与 dormant 注册

`workbenches/contract_routes.py` 只提供 C4 的 operation metadata、参数、response models 和统一 fail-closed dormant handler。路由注册必须满足：

1. 默认 app 不 include Workbench router；
2. `openapi_export` 在进程内显式开启 dormant 模式时 include 同一 router，只为 schema 生成调用；
3. dormant 模式的 handler 在所有 15 个 method/path 上都返回同一不透明、不可重试的通用 404，不能返回示例成功数据，也不能执行数据库、Session、CSRF、限流、网络或 mutation；
4. 正式能力开关和真实 handler 注入留给后续 API/数据库实现门，本门不能用 stub 结果冒充成功数据；
5. `/imports` 与 `/links/reorder` 先于动态 UUID 路由注册；自定义 UUID route converter 在 FastAPI/Pydantic 校验前将非法 UUID、`fixed.*` 与未知静态子路径统一为通用 404。

统一 404 由一个最小 `DormantContractRoute(APIRoute)` 实现：`get_route_handler()` 在读取 Header、path/body 参数或执行 FastAPI dependency 之前直接返回现有通用 404，绝不调用原 endpoint handler。路由函数上的 Pydantic/FastAPI 声明仍只用于 OpenAPI 生成。禁止用第二套 Session/CSRF dependency 或为每个 operation 手写 path Schema。该拦截覆盖合法、缺失和畸形 body/Header；非法 UUID、`fixed.*` 与未知静态子路径则由 route converter/路由顺序在同样早期结算。

C4 已明确不新增 `components.securitySchemes`。dormant 候选不得添加 security scheme，也不得给 Workbench operation 添加 `security` 对象；Session cookie、trusted Origin 和 CSRF 只作为运行时顺序与显式 Header 参数进行合同说明，不读取 cookie、不创建 dependency、不执行认证。默认 app 与 dormant app 的既有 operation security 元数据必须保持原样；任何新增 scheme 或 operation security 都是越界变化，立即停止。

### 3.3 安全边界的合同测试

合同测试只能使用进程内 app factory 与无数据库 transport，并必须锁定：

- 默认 app 与未知路径的 status/body/headers 完全一致，且 DB/Session/CSRF/限流 spy 调用数为 0；
- 所有 mutation/import/export operation 的 `Origin` 与 `X-CSRF-Token` Header 参数出现在候选 OpenAPI；其 `security` 字段缺失，Session 仅按运行时说明保留，不出现在 OpenAPI 元数据；
- 对 15 个 method/path 逐项发送最小合法请求，全部必须得到同一通用 404；DB、Session、CSRF、限流、网络和 mutation construction/invocation spy 全部为 0；
- 对每个需要 body/Header 的 operation 再发送缺失 body、畸形 JSON、Schema 非法 body、缺失 required Header 和非法 Header；这些请求也必须在解析/校验前得到同一通用 404，且所有副作用 spy 为 0；
- 非法 UUID、`fixed.*` 和未知静态子路径在 body validation 前得到同一通用 404；
- 生成的响应不暴露 owner、内部 ID、fingerprint、对象正文、成员、ACL、剩余配额或拒绝值；
- dormant 只构造 schema，不创建 Workbench，不写 receipt，不调用网络或数据库。

本门只验证 OpenAPI 中的安全 Header/Schema 元数据与 dormant 零副作用，**不验证或伪造**真实 Session、CSRF、owner、raw-body、ACL、并发或写入顺序；这些运行时顺序明确留到正式 API 数据路径门。不得为测试建立第二套安全 dependency。若测试需要真实授权或持久化，立即停止并转入后续门。

## 4. OpenAPI 候选生成与语义差分

实施前必须保存当前 OpenAPI 的语义 manifest，至少包含：paths、operationId、parameters、responses、security、components 名称与 schema 约束。

### 4.1 逐 operation 精确 manifest

测试内维护一份仅用于断言的精确 manifest；它不是第二份 OpenAPI。下方旧表仅作阅读索引，不能作为实现输入；机器断言必须使用紧随其后的绝对路径、完整 `$ref`、参数 profile、response header 和 `security` 定义。每条 manifest 记录必须同时断言 method/path/operationId、request body、成功响应、请求 Header、成功响应 Header、错误状态和逐 operation `security` 对象。

精确 profile 定义：`WID`/`LID` 是 required path 参数 `workbench_id`/`link_id`，schema `{type:string,format:uuid}`；`SESSION` 是运行时 Session 语义标记，**不生成 Cookie 参数或 OpenAPI security 对象**；`ORIGIN` 是 required Header `Origin`，string `minLength=1,maxLength=2048`；`CSRF` 是 required Header `X-CSRF-Token`，string `minLength=1,maxLength=4096`；`IDEMPOTENCY` 是 required UUID Header `Idempotency-Key`；`IF_MATCH` 是 optional `If-Match`，string `minLength=2,maxLength=256`；`IF_NONE_MATCH` 是 optional `If-None-Match`，string `minLength=1,maxLength=1024`；`LIFECYCLE` 是 optional query enum `[active,archived]`；`LIMIT_50`/`LIMIT_100` 是 optional integer query，范围分别 `1..50 default=25` 与 `1..100 default=50`；`CURSOR` 是 optional nullable string query `maxLength=1024`；`INCLUDE_LINKS` 是 optional boolean query `default=false`。所有 JSON request/response media type 均为 `application/json`；request body 为 required，精确引用 `#/components/schemas/<名称>`；`304` 无 content；每条 manifest 的 `security` 必须是 `absent`，而不是新增 scheme。

响应 profile：`NO_STORE` 是 required string const `private, no-store`；`ETAG` 是 required string `minLength=2,maxLength=256`；`LOCATION` 是 required string；`CONTENT_DISPOSITION` 是 required string pattern `^attachment; filename="workbench-[0-9a-f-]{36}\\.json"$`。所有已声明错误响应必须含 `NO_STORE`；所有 429 还必须含 required `Retry-After`，integer `minimum=1,maximum=3600`。错误 `$ref` 固定为 400 `#/components/schemas/WorkbenchPreconditionInvalidErrorResponse`、401/413/503 `#/components/schemas/ErrorResponse`、403 `#/components/schemas/WorkbenchForbiddenErrorResponse`、404 `#/components/schemas/WorkbenchNotFoundErrorResponse`、409 `#/components/schemas/WorkbenchConflictErrorResponse`、422 `#/components/schemas/WorkbenchValidationErrorResponse`、429 `#/components/schemas/WorkbenchRateLimitedErrorResponse`；禁止未列出的 default response。

机器 manifest 的 15 条绝对记录如下。Schema 名必须机械展开为 `#/components/schemas/<名称>`；每个 `errors` 状态必须机械展开为上段唯一 `$ref`、`application/json` 和 `NO_STORE`，429 再加 `Retry-After`；每条记录的 `security=absent`。实现测试必须把展开后的完整对象与 OpenAPI 子树深比较，禁止只比较缩写字符串。

```text
GET    /api/v1/users/me/workbenches                                      workbench_definition_list          body:-                                      params:SESSION,LIFECYCLE,LIMIT_50,CURSOR                         success:200 WorkbenchDefinitionPageResponse;NO_STORE                                      errors:401,422,429,503
POST   /api/v1/users/me/workbenches                                      workbench_definition_create        body:WorkbenchDefinitionCreateRequest     params:SESSION,ORIGIN,CSRF,IDEMPOTENCY                           success:201 WorkbenchDefinitionResponse;LOCATION,ETAG,NO_STORE                            errors:401,403,409,413,422,429,503
POST   /api/v1/users/me/workbenches/imports                              workbench_import                   body:WorkbenchImportRequest              params:SESSION,ORIGIN,CSRF,IDEMPOTENCY                           success:201 WorkbenchImportSucceededReceipt;NO_STORE | 200 WorkbenchImportFailedReceipt;NO_STORE errors:401,403,409,413,422,429,503
GET    /api/v1/users/me/workbenches/{workbench_id}                       workbench_definition_get           body:-                                      params:SESSION,WID,IF_NONE_MATCH                              success:200 WorkbenchDefinitionResponse;ETAG,NO_STORE | 304;ETAG,NO_STORE                  errors:401,404,422,429,503
PUT    /api/v1/users/me/workbenches/{workbench_id}                       workbench_definition_replace        body:WorkbenchDefinitionReplaceRequest    params:SESSION,WID,ORIGIN,CSRF,IF_MATCH                         success:200 WorkbenchDefinitionResponse;ETAG,NO_STORE                                     errors:400,401,403,404,409,413,422,429,503
POST   /api/v1/users/me/workbenches/{workbench_id}/archive               workbench_definition_archive       body:WorkbenchDefinitionLifecycleRequest  params:SESSION,WID,ORIGIN,CSRF,IF_MATCH                         success:200 WorkbenchDefinitionResponse;ETAG,NO_STORE                                     errors:400,401,403,404,409,413,422,429,503
POST   /api/v1/users/me/workbenches/{workbench_id}/restore               workbench_definition_restore       body:WorkbenchDefinitionLifecycleRequest  params:SESSION,WID,ORIGIN,CSRF,IF_MATCH                         success:200 WorkbenchDefinitionResponse;ETAG,NO_STORE                                     errors:400,401,403,404,409,413,422,429,503
GET    /api/v1/users/me/workbenches/{workbench_id}/deletion-impact       workbench_definition_deletion_impact_get body:-                                  params:SESSION,WID                                      success:200 WorkbenchDefinitionDeletionImpact;NO_STORE                               errors:401,404,422,429,503
DELETE /api/v1/users/me/workbenches/{workbench_id}                       workbench_definition_delete         body:WorkbenchDefinitionDeleteRequest     params:SESSION,WID,ORIGIN,CSRF,IDEMPOTENCY,IF_MATCH               success:200 WorkbenchDefinitionDeleteReceipt;NO_STORE                                errors:400,401,403,404,409,413,422,429,503
GET    /api/v1/users/me/workbenches/{workbench_id}/export                workbench_definition_export        body:-                                      params:SESSION,WID,ORIGIN,CSRF,INCLUDE_LINKS                    success:200 WorkbenchExportV1;CONTENT_DISPOSITION,NO_STORE                              errors:401,403,404,422,429,503
GET    /api/v1/users/me/workbenches/{workbench_id}/links                 workbench_link_list                body:-                                      params:SESSION,WID,LIMIT_100,CURSOR                           success:200 WorkbenchLinkPageResponse;ETAG,NO_STORE                                     errors:401,404,422,429,503
POST   /api/v1/users/me/workbenches/{workbench_id}/links                 workbench_link_create              body:WorkbenchLinkCreateRequest            params:SESSION,WID,ORIGIN,CSRF,IDEMPOTENCY                     success:201 WorkbenchObjectLinkResponse;LOCATION,ETAG,NO_STORE                           errors:401,403,404,409,413,422,429,503
PATCH  /api/v1/users/me/workbenches/{workbench_id}/links/{link_id}       workbench_link_patch               body:WorkbenchLinkPatchRequest             params:SESSION,WID,LID,ORIGIN,CSRF,IF_MATCH                    success:200 WorkbenchObjectLinkResponse;ETAG,NO_STORE                                    errors:400,401,403,404,409,413,422,429,503
DELETE /api/v1/users/me/workbenches/{workbench_id}/links/{link_id}       workbench_link_delete              body:WorkbenchLinkDeleteRequest            params:SESSION,WID,LID,ORIGIN,CSRF,IF_MATCH                    success:200 WorkbenchLinkDeleteReceipt;ETAG,NO_STORE                                     errors:400,401,403,404,409,413,422,429,503
POST   /api/v1/users/me/workbenches/{workbench_id}/links/reorder         workbench_link_reorder             body:WorkbenchLinkReorderRequest           params:SESSION,WID,ORIGIN,CSRF                              success:200 WorkbenchLinkSetResponse;ETAG,NO_STORE                                        errors:401,403,404,409,413,422,429,503
```

manifest 还必须断言所有 path/query 参数、UUID format、limit/cursor/include_links 约束、response content type，以及 C4 列出的 400/401/403/404/409/413/422/429/503 ErrorResponse component。15 个 operation 的每个已声明错误响应都必须在 OpenAPI response header Schema 中包含 `Cache-Control`，并锁定值为 `private, no-store`；每个 429 还必须包含 `Retry-After`，Schema 为整数秒、`minimum: 1`、`maximum: 3600`，不暴露剩余配额。任一 operation 漏 body、304、DELETE body、请求或响应 Header、错误状态、错误 Header，或使用错误 response model 都必须失败。

### 4.2 两阶段生成

C5-A 候选阶段执行完整生成链两次：

```text
pnpm contracts:generate
pnpm contracts:generate
```

两次生成之间保存允许差异文件的 SHA-256 和 semantic manifest；第二次必须字节及语义稳定。现有 `contracts:check` 内部会再次生成并要求 `packages/contracts` 相对 Git HEAD 完全无差异，因此只要本门产生尚未获准提交的候选加法，它就必然按设计失败。C5-A 禁止把该预期失败报告为门禁通过，也不为此修改脚本、暂存或临时提交。

C5-A 经独立复审及 Product Owner 明确批准精确候选后，单独进入 C5-B Git 门：只提交已批准的合同候选和实现文件，然后在新 HEAD 上运行 `pnpm contracts:check`，要求绿色。没有 C5-B 明确批准，当前门保持未提交。

候选生成必须验证：

- dormant snapshot 恰好增加 10 个 path、15 个 operationId，operationId 全仓唯一；
- 默认 snapshot 不增加任何 Workbench path；
- 旧 path、operationId、参数、responses、security、UserSetting、ErrorResponse、persona、sync-v1、Vault/Outbox 无删除、重命名或语义漂移；
- `packages/contracts/src/openapi.d.ts` 只增加对应类型，不能改变既有类型定义；
- 第二次运行生成器没有 diff；
- 三个 sync-v1 生成文件两次生成前后 SHA-256 均不变且不出现在 diff；
- 候选 OpenAPI 不含 CSRF cookie、Session cookie、owner、内部 fingerprint、数据库 ID 或 Feature Flag 可写字段；
- 生成过程不需要启动 API、连接数据库、启用生产 flag 或读取生产数据。

如果生成 diff 出现旧合同删除/重命名、未批准组件、默认 app 暴露路径、重复 operationId、手写 OpenAPI 路径副本或非确定性差异，立即停止，不修补快照掩盖问题。

## 5. 验收矩阵

| 场景             | 必须证明                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Default disabled | 10 path 全部与未知路径同为通用 404，零副作用调用                                            |
| Dormant export   | 精确 10 path、15 operationId；无服务、数据库、Session 或 mutation                           |
| Schema           | strict body、discriminator、UUID、范围、nullable、required、additionalProperties 约束可生成 |
| Routing          | 15 个 dormant 请求统一 404；UUID converter 先于 body validation；所有副作用 spy 为 0        |
| Security         | mutation/import/export 明确 Origin 与 CSRF；404/403/409/422 不泄露对象或授权信息            |
| Operation matrix | 15 项 method/path/body/status/Header/security/error profile 精确匹配 C4                     |
| Error headers    | 每个错误响应 no-store；全部 429 的 Retry-After 为 1–3600 秒整数                             |
| Compatibility    | 旧 OpenAPI 与 contracts 类型只加法；sync-v1 零变化；二次生成稳定                            |
| Isolation        | API 实现门不修改数据库、迁移、配额、威胁模型、Web、生产配置或 Feature Flag                  |
| Main factory     | 移除三个批准 AST 节点后与基线相同；中间件、异常处理器、旧 router 顺序逐行零变化             |

最低门禁（在干净 C5-A worktree 执行；每条命令期望退出码 `0`）：

```powershell
$env:LOGION_I3_C5_EVIDENCE = $C5Evidence
uv run --package logion-api pytest apps/api/tests/test_workbench_openapi_contract.py apps/api/tests/test_workbench_route_disabled.py --junitxml "$C5Evidence\pytest.xml"
uv run --group dev ruff check apps/api/src/logion_api/workbenches apps/api/src/logion_api/openapi_export.py apps/api/src/logion_api/main.py apps/api/tests/test_workbench_openapi_contract.py apps/api/tests/test_workbench_route_disabled.py
uv run --group dev ruff format --check apps/api/src/logion_api/workbenches apps/api/src/logion_api/openapi_export.py apps/api/src/logion_api/main.py apps/api/tests/test_workbench_openapi_contract.py apps/api/tests/test_workbench_route_disabled.py
uv run --group dev mypy apps/api/src/logion_api/workbenches apps/api/src/logion_api/openapi_export.py apps/api/src/logion_api/main.py
corepack pnpm contracts:generate
Copy-Item packages/contracts/openapi/openapi.json "$C5Evidence\openapi.candidate.first.json"
@("packages/contracts/src/sync-v1.ts","packages/contracts/src/sync-v1-validator.generated.js","packages/contracts/src/sync-v1-validator.generated.d.ts") | Get-FileHash -Algorithm SHA256 | ConvertTo-Json | Set-Content "$C5Evidence\sync.hash.first.json"
corepack pnpm contracts:generate
Copy-Item packages/contracts/openapi/openapi.json "$C5Evidence\openapi.candidate.second.json"
@("packages/contracts/src/sync-v1.ts","packages/contracts/src/sync-v1-validator.generated.js","packages/contracts/src/sync-v1-validator.generated.d.ts") | Get-FileHash -Algorithm SHA256 | ConvertTo-Json | Set-Content "$C5Evidence\sync.hash.second.json"
node scripts/check-openapi-breaking.mjs "$C5Evidence\openapi.before.json" "$C5Evidence\openapi.candidate.second.json"
corepack pnpm exec prettier --check packages/contracts/openapi/openapi.json packages/contracts/src/openapi.d.ts
git diff --check
```

`test_workbench_openapi_contract.py` 在 `LOGION_I3_C5_EVIDENCE` 非空时必须写出规范化 `semantic-manifest.json`（只含 paths、operationId、parameters、requestBody、responses、headers、security、components schema 约束）和 `non-leakage.json`；测试失败或任一文件缺失均使门失败。协调方必须执行以下差异断言，差异即非零：

```powershell
if ((Get-FileHash -Algorithm SHA256 -LiteralPath "$C5Evidence\openapi.candidate.first.json").Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath "$C5Evidence\openapi.candidate.second.json").Hash) { throw "second OpenAPI generation is not byte-stable" }
if ((Compare-Object (Get-Content "$C5Evidence\sync.hash.before.json") (Get-Content "$C5Evidence\sync.hash.first.json")) -ne $null) { throw "sync-v1 hash changed on first generation" }
if ((Compare-Object (Get-Content "$C5Evidence\sync.hash.first.json") (Get-Content "$C5Evidence\sync.hash.second.json")) -ne $null) { throw "sync-v1 hash changed on second generation" }
if (-not (Test-Path "$C5Evidence\semantic-manifest.json")) { throw "semantic manifest missing" }
if (-not (Test-Path "$C5Evidence\non-leakage.json")) { throw "non-leakage evidence missing" }
```

`check-openapi-breaking.mjs` 负责旧合同兼容性；`semantic-manifest.json` 负责 C4/C5 精确 operation matrix 与安全/非泄露断言，不得以人工口头审查替代。禁止全仓 formatter write。`contracts:check` 明确属于批准提交后的 C5-B；C5-A 必须报告未运行及上述原因，不得以全仓 Web 测试代替 API/合同门。

## 6. 停止条件与后续顺序

遇到以下任一情况立即停止并回报：

- 需要数据库表、迁移、receipt/journal、真实事务或正式对象写入；
- 需要修改 `config.py`、生产环境、Feature Flag 默认值、反向代理或部署文件；
- 默认 app 无法与未知路径保持完全一致；
- 自定义 UUID converter 无法在 body validation 前保持通用 404，或 dormant handler 无法保持零副作用；
- OpenAPI 生成要求修改旧 Schema、安全语义或 operationId；
- 需要新增依赖、手写快照或无法保证二次生成稳定；
- 需要真实 Session、用户、Workspace/Space 或生产数据才能通过测试。

I3-C5 通过后仍需 Product Owner 分别批准：

1. 数据库/迁移/原子 receipt 与隔离证明；
2. 配额、威胁模型、URL 网络访问和 DELETE body 代理门；
3. 正式 API 数据路径与 Feature Flag 启用；
4. Persona 偏好迁移、409 用户体验和前端保存能力；
5. 集成、回滚、Git、发布与真实环境验收。

本门只提交方案和候选生成证据，不将候选合同或 dormant 路由报告为生产能力。
