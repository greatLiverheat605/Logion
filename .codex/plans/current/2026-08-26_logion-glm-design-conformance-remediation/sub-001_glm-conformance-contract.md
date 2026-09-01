# 子计划：GLM Conformance Contract 与目标清单

## 元信息

- 子计划 ID：`sub-001`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 1 - 冻结 GLM Conformance Contract 与目标清单
- 创建时间：`2026-08-26T14:07:43+08:00`
- 状态：已完成 ✓
- 完成时间：`2026-08-26T14:25:54+08:00`
- AI 评分：94/100
- 创建原因：该步骤涉及设计合同、外部截图哈希清单、浏览器 helper 与合同测试共 4 个文件，超过子计划复杂度阈值

## 实现边界

- 正式路由、API、权限、Vault、sync-v1 与对象语义以正式工程合同为准。
- GLM `specs/01-05`、批准截图与布局树只作为视觉、IA 和交互目标，不复制 fixture store、hash router、手写 overlay 或原型业务代码。
- 目标截图保留在隔离 GLM 工作区，正式仓库只记录规范化绝对路径、视口、SHA-256 与预期关键区域。
- 动态真实数据使用结构、几何、唯一 primary 和关键区域断言；禁止用全页像素硬匹配代替 Product Owner 走查。

## 步骤分解

### 步骤 1：冻结人工可审计设计合同

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T14:21:30+08:00`
- **AI 评分**：92/100
- **目标**：为 21 条应用路由、9 条正式公共流程、`/offline` 与 404 记录主任务、布局树、primary、关键区域、Target 证据和允许偏离规则。
- **涉及文件**：`docs/product/GLM_DESIGN_CONFORMANCE.md`
- **验证方法**：合同与 `LOGION_ROUTE_FUNCTION_CONTRACT.md`、GLM route matrix 一一对齐；原型中的 `/auth/passkey` 明确标记为非正式路由。

### 步骤 2：生成并校验 GLM Target manifest

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T14:21:30+08:00`
- **AI 评分**：94/100
- **目标**：登记批准截图的路由、视口、外部路径与 SHA-256，并定义固定 Shell/Workbench 几何和允许偏离结构。
- **涉及文件**：`reports/ui-refactor/glm-target-manifest.json`、`.gitignore`（仅放行该机器合同，继续忽略其他运行产物）
- **验证方法**：manifest 可由 Node 解析；登记文件存在且 SHA-256 匹配；21 条应用路由和正式公共/辅助流程均有可审计 Target 映射或显式偏离说明。

### 步骤 3：建立机器合同与缺失项失败门

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T14:25:54+08:00`
- **AI 评分**：94/100
- **目标**：新增 Playwright 几何/关键区域 helper，并扩展产品化合同测试校验 manifest、正式路由覆盖、文件哈希、primary 与偏离记录。
- **涉及文件**：`tests/browser/glm-conformance.ts`、`tests/browser/prototype-productization.spec.ts`
- **验证方法**：Playwright `--list`、TypeScript/Prettier 和目标测试通过；删除 Target、篡改哈希或遗漏正式路由时断言会失败。

## 执行记录

| 时间             | 操作                                   | 结果                                                                                              |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2026-08-26 14:07 | 创建子计划并进入步骤 1                 | 执行中；父计划与 MCP `R1` 同步启动                                                                |
| 2026-08-26 14:21 | 步骤 1：冻结人工可审计设计合同         | 92/100；32 个验收对象的任务、布局树、primary、区域、Target 和偏离规则齐全                         |
| 2026-08-26 14:21 | 步骤 2：生成并校验 GLM Target manifest | 94/100；66 个 PNG 全部存在，SHA-256 与实际尺寸匹配，21/9/2 路由覆盖准确                           |
| 2026-08-26 14:25 | 步骤 3：建立机器合同与缺失项失败门     | 94/100；结构/hash Gate、破坏样本、Playwright discovery、168 tests、typecheck、lint 与格式检查通过 |
