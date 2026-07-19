# ADR-0004：Workspace、Space 与权限模型

- 状态：Accepted
- 日期：2026-07-19
- 决策人：Logion project owner

## 背景

Logion 同时服务个人、备考、自学、研究和导师/小组。Workspace 管理角色不能自动获得成员私人学习正文，否则无法满足私密默认和长期研究使用。

## 决策

Workspace 是租户和计费边界；Space 是内容可见性边界。业务对象必须带 `workspace_id` 和 `space_id`。Private Space 仅其 owner 可访问；Workspace Owner/Admin 不自动获得正文读取权。Shared Space 根据 membership、规范角色和命名 permission 授权。

规范角色为 owner、admin、editor、contributor、reviewer、viewer。`member` 仅作为旧数据迁移别名。服务端每次访问同时校验身份、membership、Space、对象归属和 entitlement；客户端按钮隐藏不构成授权。

## 后果

- repository 查询从租户/Space 范围开始，不能先按对象 ID 查询再过滤；
- 搜索、通知、导出、AI 输入、备份和后台任务遵守同一权限边界；
- 私有内容移入共享 Space 属于披露操作，需要最近认证、影响预览和审计；
- 每种新资源必须有跨用户、跨 Workspace、跨 Space 和撤销后的负向测试。
