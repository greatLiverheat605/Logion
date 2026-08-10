# 主线验收清单

## 接管与基线

- [ ] 已按 `AGENTS.md` 顺序读取长期工作流、V020 状态、RC6 证据、当前 Run 和完整交接包。
- [ ] 已记录 branch、HEAD、`origin/main`、远端可达性和完整 `git status`。
- [ ] 已确认产品 source SHA、文档 main SHA、manifest SHA 和运行镜像的不同职责。
- [ ] `.tmp-v020-rc2/` 与 `.tmp-v020-rc4/` 保留原样且未进入提交。
- [ ] 协调账本验证结果按实际记录；历史 safe-scan blocker 未被改写或伪装为通过。

## RC6 受控 prerelease

- [ ] API ready source SHA、迁移头和四个运行应用镜像与 RC6 manifest 一致。
- [ ] 公网与 loopback health、安全响应头、证书和端口边界通过。
- [ ] API/Worker/Web/Reverse Proxy/Backup/PostgreSQL/Redis 无 OOM 或异常重启。
- [ ] 严重日志、磁盘、内存、Swap、容器资源和备份新鲜度在停止线内。
- [ ] 发布后备份通过服务器校验、BitLocker 异机 SHA-256 复核和隔离恢复。
- [ ] RC2 回滚源码、旧镜像、部署前后备份和数据卷未清理。

## 认证 UX

- [ ] 使用同一可控登录会话，未读取 Cookie、localStorage、密码或会话文件。
- [ ] 21 个受保护路由均渲染已认证应用壳，不出现登录表单或 SessionBoundary 抖动。
- [ ] Today、Review、Workspace、Space、邀请、搜索、Settings、Profile、Security、Sync、Data、Integrations、AI 的核心操作已人工复测。
- [ ] 成功、失败、空值、loading、disabled、防重复提交、权限和离线状态均有明确就地反馈。
- [ ] 邀请 409 显示可行动中文提示；未向真实邮箱发送邀请。
- [ ] 1440/1024/390/320 px 无横向溢出；移动知识列表和桌面图谱键盘导航可用。
- [ ] 明暗主题、焦点、读屏语义、axe、reduced-motion 和主题持久化 XSS 防护通过。
- [ ] 浏览器控制台无新的 error；请求失败保留可追踪且去敏的恢复提示。

## 前端重设计审批

- [ ] 两个方案均完成产品诊断、UX 审查、信息架构、交互、视觉、Design System 和高保真原型。
- [ ] 两个方案使用相同事实基线、独立 worktree/目录，未修改 `apps/web/src/**`。
- [ ] 原型覆盖桌面/移动、明暗主题、核心状态、知识图谱和系统操作页。
- [ ] 方案明确减少认知负担、操作步骤和无反馈按钮，而非只替换颜色/圆角。
- [ ] 用户已经明确选择、组合或退回方案；未批准前没有正式前端施工。
- [ ] 获批方案已冻结页面/组件/状态矩阵、tokens、交互和响应式规则。

## 安全与发布

- [ ] Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 仍关闭。
- [ ] 不启动本机 Docker，不绕过 SessionBoundary，不写入秘密、私有主机或真实用户数据。
- [ ] 真实邮件、实体设备、Production、切流和回滚点清理均有用户当前明确授权。
- [ ] Commit/push/merge/release 权限与当前任务包一致；未从模型品牌推断权限。
- [ ] 所有检查记录实际命令、退出码和结果；未运行项单列原因与风险。
