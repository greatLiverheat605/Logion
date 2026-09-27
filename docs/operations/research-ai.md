# 研究 AI 配置与比较

研究功能默认关闭，只有获批的测试环境可设置 `LOGION_RESEARCH_V3_ENABLED=true`。
R1 不部署或启用生产环境。沿用现有 AI Provider、模型、路由和预算配置；不新增 Provider 类型。

## Provider

DeepSeek 与 GLM 均使用 `openai_compatible`。管理员按所用服务的当前官方文档填写
兼容端点与模型标识，在现有安全设置界面录入凭据；不要放入仓库、命令参数或截图。
出站主机允许列表示例为 `api.deepseek.com`、`open.bigmodel.cn`，只开放实际使用的主机。
如果使用经批准的其他接入方式，以其已核验主机为准；不照搬示例端点。
保留 HTTPS、公开 DNS 地址检查、证书、禁重定向、限时与预算保护。

先在测试环境检查 Provider 健康状态，再配置支持 JSON 输出的模型与价格。
通过研究路由预设选择经济档和高质量档的模型列表；顺序沿用现有主模型／后备模型规则。
预设仅创建缺失的整组七条路由，遇到已有任务路由会回滚，请使用既有版本化编辑接口调整。
经济档服务翻译和周评论，其余五类使用高质量档。选择模型仍由实际比较和所有者决定。

## 可选比较脚本

`scripts/compare-research-models.py` 仅使用内置的三段合成材料，比较细读摘要和局限说明。
它不会读取数据库、想法、账户设置或私人文件。所有请求都是实际的付费调用，只有所有者
在运行时提供临时环境变量后才执行；仓库和输出均不保存 Key。

为 `DEEPSEEK` 和 `GLM` 分别提供以下环境变量，值由所有者在自己的进程环境中设置：

- `LOGION_COMPARE_<PROVIDER>_KEY`
- `LOGION_COMPARE_<PROVIDER>_BASE_URL`
- `LOGION_COMPARE_<PROVIDER>_MODEL`

运行：

```bash
uv run --package logion-api python scripts/compare-research-models.py
```

缺少变量时打印“未运行模型对比”并以状态 2 退出，不产生网络请求或结果文件。
结果位于被 Git 忽略的 `.local/ai-comparison/`，只包含合成输出、耗时、用量和规范化错误码。
运行后人工比较忠实度、引用准确性、局限说明和成本；脚本不自动宣布胜者，也不改变路由。
