# ADR-0065：研究功能启用时的 API 出站网络

- 状态：Accepted；所有者于 2026-10-01 批准方案 1。
- 日期：2026-10-01
- 相关：[ADR-0040](0040-zotero-and-webdav-integration.md)、[ADR-0048](0048-pdf-preparation-and-read-only-retrieval.md)、[ADR-0063](0063-upgraded-schema-rollback.md)。

## 背景

v0.3 的 Zotero `/keys/current`、坚果云 WebDAV `PROPFIND` 连接测试，PDF 导入的
`MKCOL`/`PUT`、PDF 准备的 `GET`，以及 AI 模型发现均在 API 进程内发起。
基础 Compose 只将 API 接入 `internal: true` 的 `backend` 网络；仅给 Worker 出站能力
不能满足这些调用。终审 F4 已复现仅连接 backend 的候选 API 无法解析外部服务主机。
隔离验收曾使用 API egress 覆盖，但生产手册遗漏了这一前置条件。

## 决定与边界

基础 `compose.yaml` 保持不变。研究开关开启的部署通过受控覆盖文件将 API 接入
`networks: [backend, egress]`，复用已与 backend 分开的 egress 网络；在打开开关前重建
API 容器并核对实际网络和 HTTPS 可达性。Worker 保持现有 backend 与 egress 接入。
PostgreSQL 和 Redis 仍只在 internal backend，**不得加入 egress**。

egress 提供外网路由，并不按域名或端口过滤流量。安全边界依赖现有应用层控制：

- 集成仅允许固定主机 `api.zotero.org`、`dav.jianguoyun.com` 的 HTTPS 443。
  每次请求校验 DNS 的全部结果均为公网地址，再将连接固定到已校验地址，同时保留原主机的
  Host、TLS SNI 与证书校验，避免重新解析时绕过检查。回环测试 origin 仅允许 test 环境。
- 集成客户端设置 `trust_env=False` 和 `follow_redirects=False`，不使用环境代理或跟随
  重定向；拒绝非 identity 内容编码。普通响应默认上限 2 MiB，PDF 下载/导入受
  `LOGION_PDF_MAX_BYTES` 限制（默认 100 MiB），MKCOL/PUT 响应上限 64 KiB；请求有超时。
- AI 模型发现与生成适配器同样拒绝包含非公网地址的 DNS 结果，固定连接地址并验证 TLS，
  禁代理、禁重定向且限制响应大小。模型主机按既有 AI 准入单独批准；不扩大集成主机白名单。

实现依据为 API 的 `integrations/network.py`、`library/pdf_routes.py` 和
`ai_gateway/network.py`、`adapter.py`、`generation_adapter.py`。本决定不修改应用实现，
也不把应用校验描述成网络防火墙；若 API 进程被攻陷，egress 本身不能限制其任意外呼。

## 未采用的方案

- **改由 Worker 发起**：需要调整同步连接测试、PDF 上传/准备及模型发现的 API 合同、
  任务调度、结果传递和失败处理，涉及凭据与文件生命周期。它不是本次文档修正范围内的
  部署变更，会扩大已冻结候选的回归面。
- **增加出站代理**：可提供独立的网络策略边界，但需新增代理服务、目标白名单维护、
  TLS/认证及故障处置，并调整当前禁止代理的客户端。当前小规模部署采用已批准的应用层
  控制；将来若要求独立于 API 进程的强制出站限制，应另立 ADR 和实施验收。

## 发布与回滚验收

[v0.3 发布手册](../../infra/runbooks/v03-release.md) 的覆盖模板和第 6 步要求
`docker inspect` 核对 API 的 backend/egress 成员关系，并从 API 容器内对两个集成主机及
已批准模型主机执行不带凭据的 HTTPS 检查。DNS、连接或 TLS 失败阻断启用；HTTP 响应只证明
网络可达，不能代替连接凭据、PDF 和模型发现的业务验收。

已选回滚 A 切换到兼容旧应用后保留该网络覆盖并重做两项检查，研究与 Agent 开关保持关闭；
正常旧 AI 模型发现仍需 API 出站。B 为前向修复后备策略，同样重新检查网络再恢复批准的功能。
策略选择不等于批准生产执行，A 的 schema/镜像兼容门和所有者的具体切换批准仍是前置条件。
