# ADR-0066：研究 AI 的会话要求与输出额度

- 状态：Accepted；所有者于 2026-10-02 批准取消研究 AI 的“最近 10 分钟登录”要求。
- 日期：2026-10-02
- 相关：[ADR-0013](0013-ai-provider-credential-boundary.md)、[ADR-0041](0041-ai-privacy-classes-and-task-routing.md)、[ADR-0045](0045-shell-visual-system-and-reader.md)。

## 背景

rc2 在真实服务测评中暴露两类问题：

- 研究 AI 运行复用了 v0.2 AI 工作台的写入边界，要求会话创建于最近 10 分钟内。阅读通常持续数小时，
  登录 10 分钟后翻译、解释、提问、精读起草、出题、批改、连线建议和周点评全部返回
  `AUTH_RECENT_LOGIN_REQUIRED`，只能退出重登。
- 前端为各研究任务写死 1000–2000 的输出额度。当前 DeepSeek 等推理模型先输出推理内容并计入
  `max_tokens`，额度耗尽时 `finish_reason=length` 且正文为空，原实现报“服务商不可用”。路由上的
  输出上限只作封顶，所有者无法通过设置纠正。

## 决定

1. 研究任务（translate、explain、close_reading、quiz_generate、quiz_grade、link_suggest、
   weekly_comment）的运行创建，以及精读、测验草稿的接受/放弃，不再要求最近认证。保留会话、可信
   Origin、CSRF、按用户与工作区的频率限制、`AI_USE` 权限、空间授权、月度预算、隐私白名单与想法闸门。
   服务商、模型、路由、预算、AI 与集成凭据的修改，以及旧版 `/app` AI 工作台，仍要求最近认证。
2. 研究运行不再由客户端指定输出额度；未提供时使用该任务路由的 `max_output_tokens`。研究预设默认
   输入上限 64000、输出上限 8000，已有路由不自动改写。
3. 生成适配器忽略 `reasoning_content`。`finish_reason=length` 且正文为空或不是完整 JSON 时返回
   `AI_OUTPUT_TRUNCATED`，界面提示提高该任务路由的输出上限。
4. 服务端研究技能统一要求以简体中文输出，科研术语、基因与方法名称、符号和来源标签保持原文；
   翻译默认译为简体中文。

## 影响

被盗用的有效会话可以在预算与频率限制内发起研究 AI，但不能修改服务商、凭据、路由或预算，也不能读取
想法。费用上限仍由月度预算与路由上限约束；更大的默认输出上限会提高单次预留，不改变实际计费。
