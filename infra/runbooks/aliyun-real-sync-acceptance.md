# 阿里云真实同步验收手册

> 适用环境：Logion 阿里云封闭测试部署（个人或最多 10 人）
>
> 验收目标：确认真实 FastAPI、PostgreSQL、Redis、Web 与两个独立浏览器之间的 `sync-v1` Push/Pull 链路可用
>
> 不适用：本机临时 API 替身、只返回固定 JSON 的 Mock Server、公开互联网 Production

## 1. 这项验收验证什么

本手册验证以下完整链路：

```text
浏览器 A 本地 Vault
  -> 加密 Outbox
  -> Web 同源 /api 入口
  -> FastAPI sync-v1 Push
  -> PostgreSQL 同步账本
  -> FastAPI sync-v1 Pull
  -> 浏览器 B 本地 Vault
```

必须同时完成三种场景：

1. 浏览器 A 在线创建记录，浏览器 B 可以回读；
2. 浏览器 B 在线创建记录，浏览器 A 可以回读；
3. 浏览器 A 离线创建记录，恢复网络后 Outbox 能够清空或回到原始基线，并由浏览器 B 回读。

本机的离线单元测试、API 单元测试和契约检查不能替代这项验收；反过来，本手册也不能替代自动化测试。

## 2. 对后续推进的影响

这项验收不会阻塞：

- 页面视觉和交互优化；
- 不改变同步、权限、API 或数据模型的前端工作；
- 单元测试、类型检查、构建和契约检查；
- 单设备本地 Vault、离线保存和 Outbox 降级保护。

这项验收会阻塞：

- 宣称“跨设备同步已验证”；
- 宣称“阿里云封闭功能测试完成”；
- 清除旧浏览器站点数据或旧服务器数据；
- 扩大到真实多人使用；
- 正式发布或 Production 签字。

在验收完成前可以继续后续产品开发，但必须把真实同步保留为发布阻断项，不能用本机 Mock 的结果代替。

## 3. 安全规则

测试期间必须遵守：

- 不在命令、聊天、Issue、截图或验收记录中写入密码、Cookie、CSRF Token、Vault 口令、TOTP 种子或恢复码；
- 测试数据只使用无隐私的占位内容，不使用真实论文、工作资料或个人笔记；
- Vault 口令与账户登录密码分开，不复用生产密码；
- 不打开 8080、5432 或 6379 的公网安全组端口；
- 不复制浏览器 Network 面板中的 Cookie、请求头或完整正文；
- 同步失败时不清除浏览器站点数据、不删除 Docker 卷、不重建数据库；
- 不运行 `docker compose down --volumes`、`docker volume prune` 或 `docker system prune -a --volumes`。

测试标题使用以下格式，便于识别和以后清理：

```text
SYNC-ACCEPT-<UTC时间>-A-ONLINE
SYNC-ACCEPT-<UTC时间>-B-ONLINE
SYNC-ACCEPT-<UTC时间>-A-OFFLINE
```

正文只写：

```text
Non-sensitive sync acceptance record. Safe to delete after verification.
```

## 4. 前置条件

开始前必须满足：

- 已按 [阿里云 2 核 2 GB 封闭测试部署手册](./aliyun-2c2g-staging-deployment.md) 完成服务器启动；
- 既有 Owner 可以正常登录；
- 注册模式仍为 `invite` 或 `closed`；
- Web 只通过 SSH 隧道访问 `http://localhost:8080`；
- API、Web、Worker、PostgreSQL、Redis、Reverse Proxy 均为 healthy；
- 已存在一份近期可验证的加密备份；
- 准备两个相互隔离的浏览器环境。

推荐的两个浏览器环境：

- 浏览器 A：Chrome 或 Edge 的普通个人资料；
- 浏览器 B：Firefox，或 Chrome/Edge 的另一个独立个人资料。

不要只开同一浏览器的两个普通标签页；它们会共享 Cookie、IndexedDB 和 Vault，不能代表第二设备。

## 5. 测试前服务器检查

### 5.1 建立 SSH 隧道

在你的电脑上打开一个终端，执行：

```bash
ssh -N -L 8080:127.0.0.1:8080 root@<ECS_PUBLIC_IP>
```

将 `<ECS_PUBLIC_IP>` 替换为 ECS 公网 IP。此终端在测试期间保持运行，不要关闭。

浏览器只能访问：

```text
http://localhost:8080
```

不要改用服务器公网 IP，也不要为 8080 增加公网安全组规则。

### 5.2 确认运行版本和服务状态

另开一个 SSH 会话，在服务器执行：

```bash
cd /opt/logion
date -u
git rev-parse HEAD
logion-compose ps
curl --fail --silent http://127.0.0.1:8080/healthz
echo
logion-compose exec -T api python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"
```

预期结果：

- `git rev-parse HEAD` 是本次批准部署的固定提交；
- 所有长期运行服务均为 healthy；
- `/healthz` 成功；
- API ready 返回 `service: api`，且 application、database、redis 均为 `ok`；
- 返回内容不能只是 `{"status":"ok"}`。

如果 API ready 只有固定的 `{"status":"ok"}`，停止测试。当前访问的可能是 Mock Server 或错误服务，不是真实 FastAPI 候选。

### 5.3 确认 Web 指向真实 API

执行以下检查。命令只验证内部地址，不显示密码：

```bash
logion-compose exec -T web sh -c \
  'test "$LOGION_PUBLIC_API_URL" = "http://api:8000"'
```

没有输出且退出码为 0 才能继续。

再从 Web 容器访问 API：

```bash
logion-compose exec -T web node -e \
  "fetch('http://api:8000/health/ready').then(async r => { console.log(r.status); console.log(await r.text()) }).catch(e => { console.error(e.message); process.exit(1) })"
```

预期 HTTP 状态为 200，响应包含 FastAPI 的 API 版本与依赖检查。

### 5.4 记录测试基线

执行：

```bash
cd /opt/logion
TEST_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TEST_ID="$(date -u +%Y%m%dT%H%M%SZ)"
printf 'TEST_STARTED_AT=%s\nTEST_ID=%s\n' "$TEST_STARTED_AT" "$TEST_ID"
logion-compose ps
docker stats --no-stream
```

把 `TEST_STARTED_AT` 和 `TEST_ID` 记录在验收表中。它们不属于秘密。

不要把账户密码或 Vault 口令赋值给 Shell 变量。

## 6. 浏览器 A：在线同步

### 6.1 登录和初始化本地 Vault

1. 在浏览器 A 打开 `http://localhost:8080`；
2. 使用既有 Owner 账户登录；
3. 确认顶部工作区与目标 Space 正确；
4. 点击顶部“已锁定”；
5. 输入专门用于本次测试的 Vault 口令并解锁；
6. 进入“同步与设备”；
7. 记录当前 Outbox 数量、冲突数量和最后同步状态。

如果 Outbox 在测试前已经有积压：

1. 点击同步或重试一次；
2. 等待状态稳定；
3. 如果仍有未知积压或冲突，停止，不要继续创建测试数据；
4. 保存数量、错误码和发生时间，但不要截图正文。

### 6.2 创建浏览器 A 在线记录

1. 返回任一应用页；
2. 点击顶部“捕获”；
3. 类型选择 Markdown 笔记；
4. 标题填写 `SYNC-ACCEPT-<TEST_ID>-A-ONLINE`；
5. 正文填写本手册第 3 节的无隐私测试文本；
6. 保存；
7. 等待成功或同步反馈完成；
8. 进入“资料与笔记”，确认记录在本机可见；
9. 进入“同步与设备”，确认 Outbox 回到测试前基线。

通过标准：

- 页面明确报告已本地保存；
- 在线时同步成功；
- Outbox 不持续增长；
- 没有“同步响应未通过安全校验”、`OFFLINE_INPUT_INVALID` 或持续重试；
- 控制台没有未处理异常。

## 7. 浏览器 B：第二设备回读与反向同步

### 7.1 建立独立设备会话

1. 在浏览器 B 打开 `http://localhost:8080`；
2. 使用同一个 Owner 账户登录；
3. 确认它在“账户安全”中显示为一个独立设备；
4. 选择与浏览器 A 相同的 Workspace 和 Space；
5. 初始化并解锁浏览器 B 的本地 Vault。

浏览器 B 可以使用同一个专用测试 Vault 口令，也可以使用不同口令。Vault 口令只用于本浏览器端加密，不应使用账户登录密码。

### 7.2 验证浏览器 A 的记录

1. 在浏览器 B 进入“同步与设备”；
2. 点击同步；
3. 进入“资料与笔记”；
4. 搜索或定位 `SYNC-ACCEPT-<TEST_ID>-A-ONLINE`；
5. 确认标题和无隐私测试正文正确。

如果看不到记录：

- 先确认两个浏览器选择的是同一个 Workspace 和 Space；
- 再同步一次；
- 不要通过重新创建同名记录代替回读验证；
- 第二次仍看不到时停止并进入第 10 节。

### 7.3 从浏览器 B 反向同步

在浏览器 B：

1. 点击顶部“捕获”；
2. 创建标题 `SYNC-ACCEPT-<TEST_ID>-B-ONLINE` 的 Markdown 笔记；
3. 等待在线同步成功；
4. 确认 Outbox 回到基线。

回到浏览器 A：

1. 进入“同步与设备”并同步；
2. 进入“资料与笔记”；
3. 确认 `SYNC-ACCEPT-<TEST_ID>-B-ONLINE` 可见。

到此必须证明双向 Push/Pull 均可用。

## 8. 浏览器 A：离线 Outbox 与恢复同步

只有第 6、7 节全部通过后才执行离线测试。

### 8.1 进入离线状态

保持浏览器 A 页面已打开、已登录且 Vault 已解锁，不要刷新页面。

Chrome/Edge：

1. 按 F12 打开开发者工具；
2. 打开 Network；
3. 将网络节流从 `No throttling` 改为 `Offline`。

也可以暂时关闭本机 SSH 隧道，但不要关闭浏览器页面。使用这种方式时，恢复网络需要重新运行第 5.1 节命令。

### 8.2 创建离线记录

1. 点击顶部“捕获”；
2. 创建标题 `SYNC-ACCEPT-<TEST_ID>-A-OFFLINE` 的 Markdown 笔记；
3. 正文仍使用无隐私测试文本；
4. 保存；
5. 确认页面报告“已保存在本机、同步暂未完成”或同义状态；
6. 进入“资料与笔记”，确认本机仍能看到记录；
7. 进入“同步与设备”，确认 Outbox 比基线增加。

失败条件：

- 离线保存后记录在当前浏览器消失；
- 页面把同步失败误报为整体保存成功且没有待处理状态；
- Outbox 没有新增且记录也没有同步；
- 页面要求清除浏览器数据才能继续。

### 8.3 恢复网络并同步

1. 将 Network 改回 `No throttling`，或重新建立 SSH 隧道；
2. 先确认 `http://localhost:8080/healthz` 可访问；
3. 返回“同步与设备”；
4. 点击同步或重试；
5. 等待 Outbox 回到测试前基线；
6. 在浏览器 B 同步；
7. 确认 `SYNC-ACCEPT-<TEST_ID>-A-OFFLINE` 在浏览器 B 可见。

这一步同时证明：离线本地写入、Outbox 保留、重新联网 Push 和第二设备 Pull 可用。

## 9. 浏览器安全与锁定检查

在任一浏览器执行：

1. 打开一条测试笔记；
2. 点击顶部 Vault 锁定；
3. 确认已解密正文立即从页面移除；
4. 打开“捕获”和“专注计时”弹窗，确认它们要求先解锁；
5. 重新解锁，确认测试记录可以恢复读取；
6. 注销后确认受保护页面不能继续访问。

不要清除站点数据来模拟锁定。清除站点数据会删除尚未同步的 IndexedDB 内容，不属于本项测试。

## 10. 测试后服务器检查

在服务器执行：

```bash
cd /opt/logion
logion-compose ps
curl --fail --silent http://127.0.0.1:8080/healthz
echo
logion-compose exec -T api python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"
docker stats --no-stream
docker inspect $(logion-compose ps -q) \
  --format '{{.Name}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}}'
```

只检查测试时间后的错误摘要：

```bash
logion-compose logs --since "$TEST_STARTED_AT" --tail 300 \
  api web reverse-proxy \
  | grep -Ei 'error|exception|failed|oom|traceback' \
  | tail -n 100 || true
```

查看日志前先确认其中没有邮箱、令牌、Cookie 或用户正文；如需反馈问题，只发送已经去除敏感内容的最小片段。

## 11. 通过标准

以下项目必须全部满足：

- [ ] 浏览器 A 与浏览器 B 是独立浏览器资料目录；
- [ ] 两个浏览器登录的是同一账户、同一 Workspace 和同一 Space；
- [ ] 浏览器 A 在线记录能被浏览器 B 回读；
- [ ] 浏览器 B 在线记录能被浏览器 A 回读；
- [ ] 浏览器 A 离线记录在本机保持可见；
- [ ] 离线记录进入 Outbox；
- [ ] 恢复网络后 Outbox 回到测试前基线；
- [ ] 离线记录最终能被浏览器 B 回读；
- [ ] 锁定 Vault 后明文立即消失；
- [ ] 没有未处理同步冲突；
- [ ] 没有同步安全校验错误；
- [ ] 服务保持 healthy；
- [ ] 容器没有新增重启或 OOMKilled；
- [ ] 测试记录中没有密码、Cookie、Vault 口令或真实用户内容。

全部满足后，才能把结果记录为：

```text
阿里云真实双设备 sync-v1 验收通过。
```

## 12. 失败处理

### 12.1 出现“同步响应未通过安全校验”

立即停止新增数据，不要放宽前端校验器。

依次检查：

```bash
cd /opt/logion
logion-compose ps
logion-compose exec -T web sh -c \
  'printf "%s\n" "$LOGION_PUBLIC_API_URL"'
logion-compose exec -T web node -e \
  "fetch('http://api:8000/health/ready').then(async r => { console.log(r.status); console.log(await r.text()) }).catch(e => { console.error(e.message); process.exit(1) })"
```

正确的内部 API 地址是：

```text
http://api:8000
```

如果同步接口返回的正文只有 `{"status":"ok"}`，说明连接到了错误服务或测试替身。不要修改 `sync-v1` 契约来兼容它。

### 12.2 返回 401

1. 在浏览器重新登录；
2. 确认该设备未被撤销；
3. 不要复制 Cookie 到命令行；
4. 重新解锁 Vault 后再同步。

### 12.3 返回 403 或 CSRF/Origin 错误

确认浏览器地址严格为：

```text
http://localhost:8080
```

检查允许来源，但不要显示其他环境变量：

```bash
logion-compose exec -T api python -c \
  "import os; print(os.environ.get('LOGION_ALLOWED_ORIGINS', ''))"
```

应包含 `http://localhost:8080`。不要通过允许 `*`、开放公网 8080 或关闭 CSRF 解决。

### 12.4 Outbox 一直不下降

1. 不要清除浏览器数据；
2. 记录 Outbox 数量、错误码、UTC 时间和测试标题；
3. 确认服务器健康；
4. 最多手动重试一次；
5. 第二次仍失败时停止新增数据；
6. 保留该浏览器资料目录，等待修复后继续同步。

服务器备份不包含尚未上传的浏览器 Outbox。清除浏览器资料可能永久删除这部分数据。

### 12.5 第二浏览器看不到记录

按顺序检查：

1. Workspace 是否一致；
2. Space 是否一致；
3. 浏览器 A Outbox 是否已回到基线；
4. 浏览器 B Vault 是否已解锁；
5. 浏览器 B 是否完成一次同步；
6. 是否存在需要人工处理的冲突。

不要创建同名记录来掩盖回读失败。

### 12.6 服务出现 5xx、重启或 OOMKilled

停止浏览器写入并执行：

```bash
cd /opt/logion
logion-compose ps
free -h
docker stats --no-stream
docker inspect $(logion-compose ps -q) \
  --format '{{.Name}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}}'
logion-compose logs --since "$TEST_STARTED_AT" --tail 200 api postgres redis
```

不要删除卷或重复运行迁移。根据主部署手册第 21、22 节处理更新、回滚和故障。

## 13. 验收记录模板

复制以下模板到你的私有运维记录中。不要填写任何秘密或真实正文：

```text
测试 ID：
UTC 开始时间：
UTC 结束时间：
源提交：
镜像摘要已核对：是 / 否
浏览器 A：产品与版本，不记录个人资料名
浏览器 B：产品与版本，不记录个人资料名
初始 Outbox：A=，B=

A 在线 -> B 回读：通过 / 失败
B 在线 -> A 回读：通过 / 失败
A 离线保存：通过 / 失败
A 恢复同步：通过 / 失败
A 离线记录 -> B 回读：通过 / 失败
Vault 锁定清除明文：通过 / 失败

最终 Outbox：A=，B=
未处理冲突数：
容器新增重启数：
OOMKilled：是 / 否
错误码（如有）：
去敏后的最小错误摘要：

结论：通过 / 阻断
阻断项负责人：
复测时间：
```
