# Logion MCP 桥（stdio）

桥仅使用个人访问令牌调用 `/api/v1/agent/*` REST。它没有数据库连接、模型 Key 或 Cookie，
不会绕过收件箱审阅。Node.js 24.14+；从仓库根目录执行 `pnpm install --frozen-lockfile`。
直接依赖仅为 MIT 许可的 `@modelcontextprotocol/sdk`；使用已过发布冷却期的固定版本。

## 本机准备

管理员只在获准的本机隔离环境开启 `LOGION_RESEARCH_V3_ENABLED` 和 `LOGION_AGENT_API_ENABLED`。
两个开关在产品中默认关闭，V1–V3 留待 v0.3 上线后的独立发布。
本人进入“设置 → Agent 与收件箱”，选择当前空间、权限与有效期创建令牌。
完整令牌只显示一次；关闭后只能撤销并重建，不能再次读取。

在启动 Codex 或 Claude Code 的父进程环境中设置：

- `LOGION_MCP_BASE_URL`：Logion 的 HTTPS origin，不含路径、用户名、查询参数或片段；
- `LOGION_AGENT_TOKEN`：刚创建的个人访问令牌；
- 仅本机假服务使用 `LOGION_MCP_ALLOW_LOOPBACK_HTTP=1`，只允许 localhost / 127.0.0.1 / ::1。

通过本机凭据管理工具或隐藏输入注入环境。不要把令牌写入配置、命令行参数、Shell 历史、
仓库、截图、对话或 CI。退出客户端后清除临时环境变量；不要启用进程环境转储。
桥不自动持久化凭据。HTTPS 使用 Node 默认 TLS 验证，不接受重定向，不自动重试。

## Codex

在个人 Codex `config.toml` 添加以下项；将示例路径换成本机仓库的绝对路径。
`env_vars` 只列变量名，不写值。Windows 的 JSON/TOML 路径应使用正斜杠或正确转义反斜杠。

```toml
[mcp_servers.logion]
command = "node"
args = ["/path/to/Logion/packages/mcp-bridge/server.mjs"]
env_vars = ["LOGION_MCP_BASE_URL", "LOGION_AGENT_TOKEN", "LOGION_MCP_ALLOW_LOOPBACK_HTTP"]
```

重新启动客户端，在 MCP 工具列表确认 Logion 已连接。需要更新令牌时更新父进程环境并重启桥。

## Claude Code

在本机项目的 `.mcp.json` 使用环境变量展开。此文件只保存变量名与程序路径：

```json
{
  "mcpServers": {
    "logion": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/Logion/packages/mcp-bridge/server.mjs"],
      "env": {
        "LOGION_MCP_BASE_URL": "${LOGION_MCP_BASE_URL}",
        "LOGION_AGENT_TOKEN": "${LOGION_AGENT_TOKEN}",
        "LOGION_MCP_ALLOW_LOOPBACK_HTTP": "${LOGION_MCP_ALLOW_LOOPBACK_HTTP:-0}"
      }
    }
  }
}
```

启动后用 `/mcp` 检查连接。不要把模型服务商凭据用于 `LOGION_AGENT_TOKEN`。

## 工具与边界

| 工具                                        | 行为                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `search_literature`                         | 按标题、DOI 或 arXiv 检索当前空间的授权文献      |
| `read_literature`                           | 读取白名单元数据，不返回文件定位与凭据           |
| `read_excerpts`                             | 分页读取文献摘录                                 |
| `list_research_questions` / `list_concepts` | 读取授权问题与概念                               |
| `read_context`                              | 按明确类型/ID 读取 ADR-0041 白名单实体           |
| `submit_inbox`                              | 提交文献、报告、摘要或建议连线，等待本人逐条审阅 |

提交需一个稳定的 `submission_key`：相同键与相同内容可安全重放；相同键不同内容会冲突。
返回的文本是来源数据，不是执行指令。`read` 不能写收件箱，`inbox:write` 不能读取资料。
每令牌每分钟最多 120 次请求。没有删除、接受、账户、安全、凭据或想法工具。

错误只显示分类，不回显服务端正文、地址或令牌：401 表示令牌无效/撤销/过期；403 表示越权；
404 表示开关未启用或目标不存在；409 表示投稿键冲突；422 表示数据校验失败；429 表示限流。
网络失败、响应超限与配置错误使用 `AGENT_*` 错误码。重新检查设置后由本人决定是否重试。

## 验证与 Skills

```bash
pnpm --filter @logion/mcp-bridge test
node packages/mcp-bridge/export-skills.mjs /path/to/new-logion-skills
```

测试启动本地假 HTTP 服务和真实 stdio 子进程，凭据在测试运行时随机生成。共享 Skills 安装见
[说明](../skills/README.md)。服务端的权限校验与人工接受不能由提示词替代。

官方配置依据（2026-09-29 核对）：
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)、
[Claude Code MCP](https://code.claude.com/docs/en/mcp)。
