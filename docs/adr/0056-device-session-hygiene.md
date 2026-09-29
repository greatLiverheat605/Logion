# ADR-0056：设备身份保留与会话卫生

- 状态：Accepted（所有者 v0.3 剩余施工说明 R4-5 授权；统一独立复核仍由 Claude 执行）
- 日期：2026-09-29
- 关联：ADR-0002、ADR-0013；既有身份、Cookie 和会话合同不放宽。

## 问题与决定

正常退出清空全部 Cookie 会使同一浏览器每次登录都新建设备，旧设备列表又包含已经无会话的记录。
正常退出现在仅保留 HttpOnly 设备识别 Cookie；服务端仍撤销当前会话及其活动刷新令牌，清除 access、refresh、CSRF Cookie。
设备 UUID 不是登录凭据，只有完整通过密码、TOTP 或 Passkey 验证后，才按当前账户复用未撤销设备。
未知、损坏、他人或已撤销的设备 Cookie 均不会被复用；终止刷新错误和主动撤销当前设备仍清空全部 Cookie。

设备列表只显示本人未撤销且存在有效会话的设备。有效会话要求未撤销，且 access 或 refresh 尚未到期；
保留既有 access 可略晚于 refresh 到期的行为。设备没有有效会话严格超过 30 天后，由 Worker 标记撤销。
会话的结束时间为 `min(revoked_at, max(access_expires_at, refresh_expires_at))`，无撤销时间则用到期时间。
从未有会话的设备使用 first_seen_at；恰满 30 天不撤销。晚来的失败续期不会重新开始计时。
记录及历史会话均不物理删除，不增加迁移和依赖。

新增 `DELETE /api/v1/auth/sessions/others`，要求可信 Origin、CSRF、最近认证及每用户每分钟 10 次限流。
只撤销该用户在本次语句快照中已经存在的其他未撤销会话，保留当前会话与设备身份。
同一设备上的其他会话也撤销；之后的新登录仍须认证，属于新会话。
旧端点和响应 schema 不变。审计仅含动作、结果、对象及计数／固定原因，不含 Cookie 或令牌。

## 并发与安全审查

当前执行方审查了真实外键、所有 issue_session 调用者及刷新路径；以下设计作为统一复核的明确检查点：

- 复用设备先取 User 的 `FOR KEY SHARE`，再取 Device 的 `FOR UPDATE`，直到新会话提交。
  插入 AuthSession 会隐式取得 User 外键 key-share 锁；提前取锁避免 Device → User 与刷新 User → Device 的反向等待。
  密码、TOTP、Passkey 三条路径均复用同一个查找函数。已撤销设备也在会话创建入口拒绝。
- 清理每批至多 100 台设备，Device 行使用 `FOR UPDATE SKIP LOCKED`；拿到锁后再发起独立语句复核会话。
  登录先获得设备锁则清理跳过；清理先获得锁则登录看到撤销状态后新建设备，不能复活旧记录。
  清理不取得 User、AuthSession、RefreshToken 行锁；AuditEvent.actor_id 没有外键，不引入隐式 User 锁。
- 退出其他会话按 ID 排序锁住 AuthSession，仅撤销父会话。既有认证和刷新均检查父会话失效，
  因此不再额外锁 RefreshToken，避免反转刷新路径的锁关系。所有撤销在同一事务提交。
- Worker 满批继续处理，未满批后以 monotonic 时钟每 15 分钟检查；不通过阻塞等待拖住其他队列。
  多 Worker 可用 SKIP LOCKED 分工；失败回滚后由既有调度器继续。
- 新安全页用在线请求与内存查询，退出后清空内存并完整导航；不调用会打开 IndexedDB 的旧草稿清理。
  设备撤销和退出其他会话有明确确认；网络失败不宣称退出成功。

## 验证与限制

真实 PostgreSQL 测试覆盖 Cookie、完整重新认证、只剩 access／refresh 的有效会话、30 天边界、
晚到失败续期、历史行保留、两种清理与登录顺序、真实 User 外键锁等待、跨账户隔离、
Origin／CSRF／最近认证／限流、旧 access 与 refresh 拒绝；既有身份、TOTP、Passkey 回归保持有效。
浏览器覆盖新安全页的确认、取消、设备撤销、退出、再次登录复用及四宽明暗、键盘、axe、在线存储边界。
Worker 不是实时计时器，闲时撤销可能晚于阈值约 15 分钟；历史记录保留，不承担物理清理职责。
本 ADR 不授权生产变更，也不改变认证方法、有效期或权限。
