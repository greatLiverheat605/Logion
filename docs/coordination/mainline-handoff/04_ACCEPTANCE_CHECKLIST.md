# 主线验收清单

## 基线与交付

- [ ] 读取 `AGENTS.md`、SOP、执行计划、状态和当前 Run。
- [ ] 记录分支、HEAD、远端可达性、目标基线和唯一 writable paths。
- [ ] 工作树无未授权修改；所有新增文件在允许范围内。
- [ ] 任务包包含固定验收命令、停止条件和回滚说明。
- [ ] 返回结构化 handoff；没有把 worker 自报等同于 coordinator acceptance。

## Main candidate / v0.2.0

- [ ] Main candidate 的 `head_sha` 等于合并提交 `2339002…`。
- [ ] `fast`、`integration`、`browser`、审计、迁移/恢复和安全检查真实执行并成功。
- [ ] 认证浏览器覆盖成功、失败、空值、加载、禁用、重复提交、权限和离线反馈。
- [ ] 邀请 409 显示明确中文提示；不发送真实邮件。
- [ ] 1440px 与 390px 无横向溢出；移动节点列表可用；桌面图谱支持键盘导航。
- [ ] `aria-invalid`、`aria-describedby`、live region 关联正确；axe 无新增违规。
- [ ] 持久化主题值经过 XSS 防护；不把用户输入当作 HTML/脚本执行。

## 生产与数据安全

- [ ] Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1、AI Acceptance 仍关闭。
- [ ] 不启动本机 Docker，不绕过 SessionBoundary，不执行未经批准的生产迁移/发布。
- [ ] 不写入密钥、令牌、密码、私有主机、真实用户数据、真实邮箱或终端转录。
- [ ] 任何外部请求失败或状态不确定时不自动重试，不产生重复计费/重复正式记录。

## 下一版本设计门

- [ ] v0.2.1 本地解析/论文证据先完成 ADR、威胁模型、容量和离线边界，再实现。
- [ ] v0.3.0 移动薄壳先完成设备矩阵、签名、恢复和撤销设计，再实现。
- [ ] v0.4.0 Connector/Automation 先完成 Credential Vault、OAuth/PKCE、签名/重放、人工确认和回滚设计，再实现。
