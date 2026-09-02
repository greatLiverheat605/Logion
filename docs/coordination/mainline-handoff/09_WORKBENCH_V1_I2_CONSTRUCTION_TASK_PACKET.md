# Workbench v1 I2 研究与考试领域施工任务包

状态：已获 Product Owner 批准进入 I2 任务包准备；正式代码施工待本包验收后开始
日期：2026-08-19
基线：`6e448ac01dc78b94f600658f2574a51cce1cca64`
分支：`codex/product-workbench-v1-spec`

## 1. 目标

在 W1 统一 Shell、Today、Context Bar、Workbench 切换器和只读 Inspector 之上，补齐研究与考试两个固定工作台的领域流程。工作台仍是已授权对象的界面投影，不是新的权限域、数据副本或服务端事实源。

本批次只允许复用现有 API、受保护本地读取、SessionBoundary、Workspace/Space ACL 和现有对象类型。发现合同缺口时停止并记录，不在前端伪造字段、权限或成功状态。

## 2. 施工顺序

### I2-R1 研究证据实验台

- 将现有研究对象按 `Research Question → Source/Excerpt → Claim → Evidence → Experiment Run → Finding/Output` 组织为可回跳的只读投影；
- 保留正式对象 ID、版本、Space 归属、同步状态和权限失败关闭；
- 区分正式、候选、争议、拒绝和待核验状态，所有关系使用文字标签；
- 研究技术感只来自证据链、版本、关系和实验轨迹，不增加霓虹、粒子或虚假实时指标；
- 研究指标/实验比较只使用已有记录，空数据、非法数值、锁定、离线、stale 和 409 均提供原因与恢复动作；
- 不改变现有 ResearchCenter 的服务端写入、Session 或 Workspace 语义；若现有写操作不满足合同，保留原行为并登记后续提案。

### I2-E1 考试覆盖指挥台

- 将现有 `Exam → Subject/Syllabus → MockExam → Score → ReviewSchedule` 组织为覆盖矩阵、复习缺口、模考和成绩轨迹；
- 倒计时必须来源于真实 `exam_at`，日期缺失显示待定，不创建虚假考试；
- 覆盖率在空大纲时显示未知/待配置，不伪造 0%；成绩趋势标注时间、样本和来源，不进行无数据预测；
- 薄弱项使用文字和受控警示，红色只表达全局危险/错误；
- 保留考试对象与其 Workspace/Space 归属、锁定、权限拒绝、离线、stale 和冲突语义；
- 不扩大 ExamCenter 的对象类型 allowlist，不增加 API、数据库字段或迁移。

### I2-Q1 领域集成与回归

- 研究和考试页面均接入现有 Workbench Context Bar、对象 Inspector 和统一反馈语义；
- Today 仍只消费统一行动闭环，不生成第二套领域首页；
- 复核五区域、21 条正式路由、导师 `/app/collaboration` 与协作空间 `/app/workspaces` 不回归；
- 补齐页面级 ready/loading/empty/error/offline/locked/permission denied/409/disabled/stale 测试；
- 真实认证浏览器、键盘、axe、四视口和控制台错误检查留在 I4 集成门，但 I2 必须为这些门保留可操作 DOM 语义。

## 3. 唯一允许写入路径

主线施工仅限以下路径；新增测试文件必须位于对应目录：

- `apps/web/src/features/self-study/self-study-center.tsx`
- `apps/web/src/features/self-study/research-workbench-model.ts`
- `apps/web/src/features/self-study/research-workbench-model.test.ts`
- `apps/web/src/features/self-study/research-experiment-comparison.tsx`
- `apps/web/src/features/self-study/research-experiment-comparison.css`
- `apps/web/src/features/self-study/**/research-*.test.ts*`
- `apps/web/src/features/exam/exam-center.tsx`
- `apps/web/src/features/exam/exam-workbench-model.ts`
- `apps/web/src/features/exam/exam-workbench-model.test.ts`
- `apps/web/src/features/exam/**/exam-*.test.ts*`

若确需修改共享 Workbench/Shell/Inspector 文件，必须先停工、提交单独范围说明并取得新的明确批准；本包不授权修改 API、contracts、数据库、迁移、OpenAPI、权限、SessionBoundary、manifest/lockfile、生产配置或 Feature Flag。

## 4. 不变量与禁止事项

- 不改变 Workspace Role、Space ACL、SessionBoundary、对象归属或数据共享语义；
- 不复制正式对象，不用 Workbench ID 替代正式对象主键；
- 不把前端隐藏入口当作权限控制；每次读取继续经过现有授权链；
- 不打开 Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 或 AI Acceptance；
- 不发送真实邮件、不读取/写入密码、Cookie、Token、生产密钥或真实用户数据；
- 不把 demo/mock 数据写进正式请求路径；
- 不提交、推送、合并或部署，除非用户对该动作单独批准。

## 5. 验收命令

施工方和协调方必须实际运行并记录结果：

```text
corepack pnpm --filter @logion/web exec vitest run <I2 target tests>
corepack pnpm --filter @logion/web test
corepack pnpm --filter @logion/web lint
corepack pnpm --filter @logion/web typecheck
corepack pnpm --filter @logion/web exec prettier --check <I2 files>
corepack pnpm --filter @logion/web build
corepack pnpm guard:context
git diff --check
```

协调方还必须检查变更白名单、敏感模式、路由回归、对象归属和旧 Persona 兼容。根级 `ci:fast` 当前受既有 Worker 第三方 mypy stub 缺失阻塞，若未先修复该独立环境问题，不得把它报告为通过。

## 6. 每轮停止与复审

每个 I2 子任务完成后立即冻结写入并派发独立只读对抗复审，至少检查：

- 领域对象链、Space/Workspace/Persona/SessionBoundary 边界；
- stale/abort/卸载/快速切换时旧结果丢弃；
- 空数据、非法数据、锁定、权限拒绝、离线、409、能力关闭闭环；
- XSS、外部 URL、敏感信息和 demo 数据泄露；
- 五区域、21 路由、旧深链接和 Persona gate 回归；
- 可访问名称、键盘语义、44px 目标和窄视口布局；
- 越界文件、依赖、API、数据库、生产开关和无用抽象。

复审发现 P1/P0 时退回最小修复，不扩展批次。没有独立 PASS，不进入下一个 I2 子任务，也不提交代码。

## 7. 交接格式

```text
Outcome: complete | partial | blocked
Base commit:
Working branch:
Changed files:
Commands actually run:
Observed results:
Unrun checks and reason:
Known risks or assumptions:
Working tree status:
Suggested next action for the coordinator:
```

当前下一步：先由协调方确认本任务包和白名单，再单独授权 I2-R1 或 I2-E1 的正式代码施工。GLM 可承担不重叠的纯模型/测试子任务，但必须使用独立 worktree、独立白名单，并由主线协调方重新验收；不得把 Worker 自报视为通过。
