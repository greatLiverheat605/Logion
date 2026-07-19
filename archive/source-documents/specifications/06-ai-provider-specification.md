# 研途 Lab AI 供应商适配规范

> 目标：提供类似 NewAPI 的灵活配置体验，同时保证个人学习数据、密钥和正式记录受控。

---

## 1. 边界

本模块负责：

- Provider 配置；
- 模型发现与手动登记；
- 统一请求和响应；
- 任务级模型路由；
- 失败降级；
- 用量与成本；
- 草稿审批；
- 安全策略与审计。

本模块不负责：

- 作为公共 API 转售或中转平台；
- 保存模型训练数据；
- 自动决定用户掌握度；
- 自动修改正式计划、验收或实验结论；
- 在离线状态伪造 AI 结果。

---

## 2. 适配器接口

```python
from collections.abc import AsyncIterator
from typing import Protocol

class AIProviderAdapter(Protocol):
    provider_type: str

    async def health_check(self) -> "HealthResult": ...
    async def list_models(self) -> list["DiscoveredModel"]: ...
    async def generate(self, request: "AIRequest") -> "AIResponse": ...
    async def stream(self, request: "AIRequest") -> AsyncIterator["AIChunk"]: ...
```

业务模块只能调用 `AIGateway`，不能直接导入供应商 SDK。

```python
class AIGateway:
    async def run_task(
        self,
        task_type: str,
        input_scope: list[InputReference],
        instructions: str | None,
        model_override_id: UUID | None,
        idempotency_key: UUID,
    ) -> AIRun:
        ...
```

---

## 3. Provider 类型

### 3.1 OpenAI-compatible（第一版必做）

支持：

- 自定义 Base URL；
- Bearer API Key；
- `/v1/models`；
- Chat Completions 风格请求；
- 如果服务支持，可增加 Responses 风格；
- JSON mode/JSON Schema 能力标记；
- 流式和非流式；
- 自定义请求头。

兼容不等于完全一致。每个 Provider 可设置能力覆盖和请求转换规则。

### 3.2 Anthropic（后续适配）

- 原生 Messages API；
- 单独处理 system、tools、usage；
- 不能假设 OpenAI 参数完全对应。

### 3.3 Ollama/vLLM（后续适配）

- 支持本地或私有网络服务；
- 明确 Base URL 的 SSRF/内网风险；
- 本地服务可无 API Key；
- 能力由用户覆盖或探测。

### 3.4 Custom

只在已有明确适配器代码时启用，不允许用户通过模板执行任意服务器代码。

---

## 4. Provider 配置

### 4.1 必填

- 名称；
- 类型；
- Base URL；
- 是否启用；
- TLS 验证。

### 4.2 可选

- API Key；
- Organization/Project；
- 自定义头；
- 超时；
- 重试；
- 代理；
- 速率限制提示；
- 价格覆盖。

### 4.3 密钥更新语义

API 返回：

- `has_api_key`；
- 指纹，例如末尾 4 位的不可逆显示；
- 永不返回原密钥。

更新请求：

- 未提交 `api_key` 表示保持不变；
- 提交空值需要明确 `clear_api_key=true`；
- 修改敏感字段需要最近认证；
- 变更写审计事件，旧值只记录存在性和指纹。

---

## 5. URL 与网络安全

用户可以配置自定义 Base URL，因此必须防范 SSRF。

默认策略：

- 仅允许 `https`；
- 本地 Provider 可在显式启用后允许 `http`；
- 拒绝云元数据地址；
- 拒绝 loopback、link-local、multicast 和未授权私网地址；
- DNS 解析后再次检查 IP；
- 跟随重定向时每跳重新校验；
- 限制重定向次数；
- 响应体设置上限；
- 健康检查不能访问任意用户提供路径，只访问适配器规定端点。

若用户明确启用私网 Provider，界面和审计中记录风险确认。

---

## 6. 模型发现与登记

### 6.1 自动发现

OpenAI-compatible：

1. 请求标准模型列表；
2. 解析 model ID；
3. 与已有模型合并；
4. 新模型默认禁用或待确认；
5. 不自动删除 Provider 不再返回的模型，只标记未发现；
6. 能力未知时不猜测为 true。

### 6.2 手动登记

用户可手动填写：

- model ID；
- 显示名；
- 上下文窗口；
- JSON、Tools、Vision、Streaming；
- 输入/输出价格；
- 默认参数。

### 6.3 能力验证

可选运行小型探测：

- 普通生成；
- JSON 结构化输出；
- streaming；
- tools；
- vision。

探测结果和用户覆盖分开保存，最终能力值注明来源。

---

## 7. AI 任务类型

第一版建议：

```text
study_session_summary
daily_review_draft
weekly_review_draft
remedial_explanation
quiz_generation
paper_card_draft
paper_comparison_draft
experiment_review_draft
plan_adjustment_suggestion
note_rewrite
```

每类任务定义：

- 输入允许对象；
- 默认 Prompt 版本；
- 是否要求 JSON；
- 敏感策略；
- 成本上限；
- 输出 schema；
- 正式写入目标；
- 用户确认方式。

---

## 8. 输入范围

前端不得直接发送任意拼接后的全部数据库内容。用户选择对象和字段：

```json
{
  "entity_type": "study_session",
  "entity_id": "uuid",
  "fields": ["summary_md", "questions_md", "mistakes_md"]
}
```

服务端：

1. 验证对象归属；
2. 验证该任务允许这些字段；
3. 应用敏感策略；
4. 生成最终 Prompt；
5. 记录 `input_scope`；
6. 默认不在普通日志记录完整正文。

---

## 9. 敏感信息策略

### 9.1 敏感标签

对象可标记：

```text
public
personal
sensitive
restricted
```

默认规则：

- public/personal：可发送已启用外部 Provider；
- sensitive：必须用户当次确认；
- restricted：禁止外部发送，仅允许明确配置的本地 Provider；
- AI API Key、密码、TOTP、恢复码永不进入 AI 输入。

### 9.2 自动扫描

发送前执行：

- 常见密钥指纹；
- 邮箱、电话等 PII；
- 本地路径和内部域名提示；
- 用户自定义敏感词；
- Vigils 数据的额外策略（未来）。

扫描结果不应自动保证安全，只作为阻止或确认条件。

---

## 10. 路由与降级

### 10.1 路由步骤

1. 获取任务路由；
2. 若用户指定 override，验证能力和权限；
3. 过滤禁用/不健康/不满足能力的模型；
4. 检查敏感策略；
5. 检查预算；
6. 调用首选模型；
7. 对允许重试的错误退避重试；
8. 对允许降级的错误选择备用模型；
9. 保存每次尝试；
10. 生成草稿或失败结果。

### 10.2 可重试错误

- 429；
- 临时 5xx；
- 连接重置；
- 超时；
- 服务端明确临时不可用。

不可自动重试：

- 认证失败；
- 请求格式错误；
- 内容策略拒绝；
- 成本超限；
- 用户取消；
- URL 安全拒绝。

### 10.3 幂等

AI 运行带 `idempotency_key`。相同任务重复提交时返回现有运行，避免网络重试造成重复费用。

---

## 11. Prompt 版本

Prompt 不是代码外的临时字符串，必须版本化：

```text
ai_prompts
ai_prompt_versions
```

版本包含：

- task_type；
- system 指令；
- 输入模板；
- 输出 schema；
- 版本说明；
- 创建时间；
- 是否启用；
- 测试样例和评测结果。

运行记录必须绑定具体 Prompt 版本。

---

## 12. 结构化输出

能使用 JSON Schema 时优先使用。服务端仍必须验证：

- JSON 可解析；
- schema 合法；
- Markdown 字段长度；
- ID 不允许由模型伪造关联；
- 枚举合法；
- 不包含危险 HTML；
- 引用声明是否有原始证据。

失败时：

- 可以执行一次受限修复请求；
- 仍失败则保存原始脱敏输出为失败草稿；
- 不直接写正式字段。

---

## 13. 草稿审批

AI 输出生命周期：

```text
pending
accepted
edited_and_accepted
rejected
expired
```

接受时保存：

- 原草稿；
- 用户最终内容；
- 差异；
- 决定时间；
- 目标实体版本；
- AI run、Provider、模型和 Prompt 版本。

如果目标实体在 AI 运行期间已被修改，接受时必须做版本检查，必要时要求用户重新比较。

---

## 14. 用量和成本

保存：

- Provider；
- 模型；
- 任务类型；
- 输入/输出 token；
- 缓存 token（如支持）；
- 估算费用；
- 延迟；
- 结果；
- 重试次数；
- 降级路径。

费用为估算值，价格来自模型配置并带版本。不要宣称与供应商账单完全一致。

可配置：

- 单次最大费用；
- 每日/月度软预算；
- 达到预算后警告或阻止；
- 本地模型不计算货币费用但记录 token 和时间。

---

## 15. 错误码

```text
AI_PROVIDER_DISABLED
AI_PROVIDER_UNHEALTHY
AI_PROVIDER_AUTH_FAILED
AI_BASE_URL_REJECTED
AI_MODEL_DISABLED
AI_MODEL_CAPABILITY_MISMATCH
AI_ROUTE_NOT_CONFIGURED
AI_BUDGET_EXCEEDED
AI_SENSITIVE_INPUT_BLOCKED
AI_REQUEST_TIMEOUT
AI_RATE_LIMITED
AI_INVALID_RESPONSE
AI_OUTPUT_SCHEMA_FAILED
AI_DRAFT_TARGET_CONFLICT
AI_IDEMPOTENCY_CONFLICT
```

错误消息必须脱敏，禁止返回 Provider 原始响应中的密钥或完整敏感正文。

---

## 16. 离线行为

离线时：

- 用户可创建“待运行 AI 任务草稿”，但默认不自动排队发送敏感内容；
- 联网后系统提醒用户确认是否运行；
- 不把离线模板生成内容冒充模型输出；
- 已有 AI 草稿可离线查看和编辑；
- Provider 和安全策略不能离线修改。

---

## 17. 测试

### 17.1 适配器契约测试

所有 Adapter 必须通过：

- 健康检查；
- 模型列表；
- 普通生成；
- 流式取消；
- 超时；
- 429；
- 5xx；
- 认证失败；
- 非 JSON 响应；
- 超大响应；
- 用量解析。

### 17.2 路由测试

- 首选成功；
- 首选超时后备用成功；
- 认证失败不盲目重试；
- 能力不符提前拒绝；
- 敏感策略阻止；
- 预算阻止；
- 幂等重试不重复收费；
- Provider 删除前依赖检查。

### 17.3 草稿测试

- 接受；
- 编辑后接受；
- 拒绝；
- 目标版本变化；
- AI 输出包含非法字段；
- Prompt 版本切换；
- 导出不包含密钥。
