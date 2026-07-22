# ADR 0020: 数据导入采用有界解析、加密预览与私有 Space 单事务提交

- 状态：Accepted
- 日期：2026-07-22
- 范围：Phase 5 / L5-021

## 决策

首版导入支持四种明确格式：`logion-export-v1` JSON、Markdown、带 `title` 列的 CSV、保守子集 BibTeX。单次源文本最多 1 MiB，规范化记录最多 1000 条。解析器不执行脚本、不展开宏、不读取本地路径、不抓取 URL，也不接受未来未知 Logion schema。

预览阶段只生成受限的 `note`、`resource`、`paper` 和 `inbox_item` 规范记录。Logion JSON 中其他对象类型被跳过并作为显式 warning 返回，不能静默伪装为已导入。源 SHA-256、计数和 warning 可见；规范记录使用数据导出独立 keyring 的不同 AAD 域加密，预览两小时到期。

提交时重新校验 membership、preview owner/version/expiry，并强制目标为当前用户拥有的 active private Space。所有对象生成全新 UUID，不恢复源 workspace、Space、成员、ACL、actor 或 ID。配额预检完成后，所有新对象与 preview 终态在一个数据库事务内提交；成功后清除规范化密文，preview 不可重复使用。

## 理由

直接恢复任意 JSON 会把 ACL、原 ID、恶意 URL、未知字段和跨租户引用带入正式数据。预览将“解析不可信输入”和“修改正式对象”分开，使用户能看到实际计数与损失性跳过。仅写入用户私有 Space 避免导入数据未经团队同意进入共享上下文。

## 后果

- 首版不是完整 workspace restore；任务、计划、复习历史和协作记录只能在后续版本化适配器具备领域不变量映射后开放。
- CSV 行作为 inbox capture 导入，不伪装成已有目标下的任务；Markdown 作为单篇 note 导入；BibTeX 只保留 citation key、title 和可选 HTTP(S) URL。
- 超过 1 MiB 或 1000 条的导入必须交给后续后台批处理工作包，不能提高同步请求上限规避容量设计。
