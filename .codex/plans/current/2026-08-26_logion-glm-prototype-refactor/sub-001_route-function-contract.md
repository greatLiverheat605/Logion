# 子计划：冻结正式路由与功能可达性合同

## 元信息

- 子计划 ID：`sub-001`
- 计划类型：子计划 (Sub)
- 父计划：[2026-08-26_logion-glm-prototype-refactor.md](../2026-08-26_logion-glm-prototype-refactor.md)
- 关联步骤：步骤 1 - 冻结正式路由与功能可达性基线
- 创建时间：`2026-08-26T01:45:43+08:00`
- 状态：已完成
- 创建原因：涉及正式路由清单、产品文档、manifest 与浏览器合同，超过 3 个文件

---

## 问题分析

GLM 原型描述了 21 条应用路由，但正式仓库仍以 12 条 Persona 主路由和 9 条二级路由分别维护；公共流程又分散在 auth、onboarding、invitation、share 与 deletion 下。现有 `PROJECT_FUNCTION_MAP.md` 正在被用户修改，不能用旧内容覆盖，因此新增独立合同文档并让 manifest/test 消费同一组常量。

---

## 实现方案

### 步骤 1：建立应用路由合同

- **状态**：已完成 ✓
- **目标**：导出 21 条应用路由及其主任务、布局范式和上下文要求。
- **涉及文件**：`apps/web/src/features/productization/prototype-view-manifest.ts`
- **验证方法**：路由常量无重复，所有 route page 存在。

### 步骤 2：建立人工可审查功能矩阵

- **状态**：已完成 ✓
- **目标**：新增独立的路由功能合同文档，记录公共流程、权限、状态和恢复路径，不覆盖用户正在修改的功能全景正文。
- **涉及文件**：`docs/product/LOGION_ROUTE_FUNCTION_CONTRACT.md`、`docs/product/PROJECT_FUNCTION_MAP.md`
- **验证方法**：21 条应用路由与正式公共流程全部列入，无原型虚构路由。

### 步骤 3：增加机器合同验证

- **状态**：已完成 ✓
- **目标**：验证路由数量、文件存在性、正式 callback 与禁止的 passkey 路由。
- **涉及文件**：manifest 单元测试、`tests/browser/prototype-productization.spec.ts`
- **验证方法**：相关 Vitest 和 Playwright contract assertions 通过。

---

## 回溯信息

- 完成后动作：更新父计划步骤 1 并继续步骤 2
- 失败处理策略：最多修复 3 轮，仍失败则暂停父计划

---

## 执行记录

| 时间             | 操作           | 结果                                        |
| ---------------- | -------------- | ------------------------------------------- |
| 2026-08-26 01:45 | 创建子计划     | 执行中                                      |
| 2026-08-26 01:50 | 完成三个子步骤 | Vitest 6/6 与 Prettier 通过；E2E 由 A5 补跑 |
