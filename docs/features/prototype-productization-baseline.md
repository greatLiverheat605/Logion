# Interactive prototype productization baseline

Recorded on 2026-07-31 against commit `ed98d5f` on
`codex/persona-phase7`.

Reference prototype:

`C:/Users/Administrator/Desktop/ai_study/prototype/logion-interactive-prototype.html`

This baseline records the existing product before prototype productization. It
does not authorize copying prototype demo data into production.

## Quality baseline

- `pnpm ci:fast`: passed.
- `pnpm test:browser`: 65 passed and 65 conditionally skipped.
- `pnpm contracts:generate`: generated the same OpenAPI hash
  (`ddf19f51e251ee81c1dcfdea849183c52b7daa0c`).
- Worktree was clean before the Phase 0 guard files were added.

## Current application shell

- Desktop uses a persistent left sidebar, sticky top tools, content canvas and
  theme toggle.
- The command palette currently navigates among persona-visible primary
  routes.
- Workspace management, persona settings, Vault status, capture, focus and
  notifications already have real application destinations or workflows.
- The persona contract contains exactly twelve primary routes.
- Research, collaboration, AI, sync, security, data, search and workspace
  management already exist as secondary workbenches.

## Current real workbenches

| Route                | Current visible heading          | Existing capability                                   |
| -------------------- | -------------------------------- | ----------------------------------------------------- |
| `/app/today`         | 今天先推进最重要的一步           | Tasks, signals, evidence and focus sessions           |
| `/app/planning`      | 把目标拆成可验收的学习路径       | Goal and route planning                               |
| `/app/review`        | 把“看过”变成真正能回忆           | Recall, mastery, quizzes, error patterns and reviews  |
| `/app/exam`          | 围绕大纲覆盖与错题风险安排备考   | Exams, subjects, syllabus, mocks and scores           |
| `/app/records`       | 资料与笔记                       | Markdown notes and resource indexes                   |
| `/app/self-study`    | 用可运行成果推动自主学习         | Inbox, tracks, projects and deliverables              |
| `/app/research`      | 论文研读与证据工作台             | Papers, claims, questions, runs, metrics and feedback |
| `/app/collaboration` | 让反馈落到共享对象和下一步行动   | Rubrics, reviews, feedback and immutable reports      |
| `/app/ai`            | 让 AI 围绕你的资料生成可审查草稿 | Runs, drafts, providers, models and routes            |
| `/app/sync`          | 离线继续工作，冲突始终显式处理   | Vault, sync queue, conflicts and device data          |
| `/app/security`      | 用清晰状态管理登录方式和设备     | Passkeys, TOTP and devices                            |
| `/app/data`          | 导出、迁移、备份与删除都可验证   | Export, import and account deletion                   |
| `/app/search`        | 在一个入口找到内容和下一步行动   | Search, notifications and calendars                   |
| `/app/workspaces`    | 把个人内容和小组协作边界看清楚   | Workspaces, Spaces, members and invitations           |

## Responsive and theme baseline

- At 390×844, the research persona bottom navigation is
  `今日 / 计划 / 自学 / 复习 / 更多`.
- The mobile menu is visible, the sidebar is off-canvas while closed and the
  inspected page has no horizontal overflow.
- The existing application provides persisted light and dark themes through
  semantic CSS variables.
- Existing browser coverage checks narrow layouts, theme persistence,
  reduced-motion behavior, keyboard focus and WCAG 2.2 AA automation.

## Known productization gaps

- The reference prototype has sixteen semantic views while the approved
  persona contract has twelve primary routes.
- Persona home content currently changes recommendations but does not yet
  provide four complete real-data dashboards.
- Several real secondary workbenches are not yet connected through one
  consistent information hierarchy.
- The reference prototype's generic integrations and automation view has no
  matching audited CRUD contract and remains deferred.
- Prototype metrics and named demo objects have no production data source and
  must never become defaults or fixtures.

The mapping guard in
`apps/web/src/features/productization/prototype-view-manifest.ts` is the
implementation boundary for these differences.
