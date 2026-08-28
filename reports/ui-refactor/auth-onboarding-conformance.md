# Auth / Callback / Onboarding GLM 一致性验收报告

## 当前结论

Auth、Callback 与 Onboarding 已按批准的 GLM PublicShell 方向完成正式实现与 AI 自检。Login、Register、Verify、Recover 和 Callback 从旧装饰分栏或通用状态页改为 440px 聚焦式公共工作区；Onboarding 从侧栏卡片加内容卡片改为 620px 七步聚焦工作区，并持续回显 Persona、Workspace、Space 与 Vault 上下文。

正式 Session Cookie、CSRF、MFA、Passkey、邮箱验证、密码恢复、token fragment、设备名称、注册策略和首次引导副作用顺序均保留。没有新增原型 `/auth/passkey`，没有复制 GLM fixture、hash router、mock 注册模式或手写 overlay。

- 公共生产矩阵：`125 passed / 7 skipped`
- Web unit：`194 passed / 194`
- TypeScript、ESLint、Prettier、production build、`git diff --check`：通过
- 四断点 After：`24/24` 文件存在、尺寸匹配、SHA-256 已记录
- Auth Before：`20/20` 文件存在、尺寸匹配、SHA-256 已记录
- Function Reachability：100%
- Product Owner 逐流程视觉验收：保留至父计划后续 Gate

## 真实验收环境

| 项目 | 记录 |
| --- | --- |
| 入口 | `http://127.0.0.1:8080` |
| Compose project | `logion-b1` |
| Git SHA | `0e12b92eaa73af1caed3064d69822a471045befd` |
| Dirty 摘要 | 83 项；保留计划内与用户既有修改，未自动提交或回滚 |
| Web image | `sha256:72d8a42352e295e44835360c7675f2f8a665c7b8b10224508f4ddf42e696ff45` |
| Web image Created | `2026-08-26T12:34:33.130122014Z` |
| Web container Started | `2026-08-26T12:34:35.154986649Z` |
| Web mounts | `0` |
| API image | `sha256:9aa32a6244840c91518b4279d7e853140a3e3a1b9b5d1da3c52d6081dcd8331b` (`logion-api:dev`) |
| API container Started | `2026-08-26T09:45:37.102690388Z`，本轮未重建 |
| Proxy image | `sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0` |
| Proxy container Started | `2026-08-26T12:34:50.4909001Z` |
| 运行状态 | Web、API、worker、Proxy healthy；`/healthz` 200 |

最终 Web/Proxy recreate 显式锁定 `LOGION_WEB_IMAGE=logion-web:glm-auth-20260826` 与 `LOGION_API_IMAGE=logion-api:dev`。Compose 所需 secret 只从当前容器环境在进程内继承，没有输出或落盘；Postgres、Redis、API、worker 和数据卷没有重建或清空。

## Before / GLM Target / After

GLM Target 根目录：

`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`

### Auth 五路由

| 路由 | 视口 | Before | GLM Target | After |
| --- | --- | --- | --- | --- |
| Login | 320x640 | [Before](before/auth-login-320x640.png) | 以 390 Target + specs 校验 | [After](after/auth-login-320x640.png) |
| Login | 390x844 | [Before](before/auth-login-390x844.png) | `pub_login-390x844.png` | [After](after/auth-login-390x844.png) |
| Login | 1024x768 | [Before](before/auth-login-1024x768.png) | 以 1440 Target + specs 校验 | [After](after/auth-login-1024x768.png) |
| Login | 1440x900 | [Before](before/auth-login-1440x900.png) | `pub_login-1440x900.png` | [After](after/auth-login-1440x900.png) |
| Register | 320x640 | [Before](before/auth-register-320x640.png) | 以 390 invite Target + specs 校验 | [After](after/auth-register-320x640.png) |
| Register | 390x844 | [Before](before/auth-register-390x844.png) | `pub_register-invite-390x844.png` | [After](after/auth-register-390x844.png) |
| Register | 1024x768 | [Before](before/auth-register-1024x768.png) | 以 1440 policy Targets + specs 校验 | [After](after/auth-register-1024x768.png) |
| Register | 1440x900 | [Before](before/auth-register-1440x900.png) | `pub_register-*-1440x900.png` | [After](after/auth-register-1440x900.png) |
| Verify | 320x640 | [Before](before/auth-verify-320x640.png) | 以 1440 Target + specs 校验 | [After](after/auth-verify-320x640.png) |
| Verify | 390x844 | [Before](before/auth-verify-390x844.png) | 以 1440 Target + specs 校验 | [After](after/auth-verify-390x844.png) |
| Verify | 1024x768 | [Before](before/auth-verify-1024x768.png) | 以 1440 Target + specs 校验 | [After](after/auth-verify-1024x768.png) |
| Verify | 1440x900 | [Before](before/auth-verify-1440x900.png) | `pub_verify-1440x900.png` | [After](after/auth-verify-1440x900.png) |
| Recover | 320x640 | [Before](before/auth-recover-320x640.png) | 以 1440 Target + specs 校验 | [After](after/auth-recover-320x640.png) |
| Recover | 390x844 | [Before](before/auth-recover-390x844.png) | 以 1440 Target + specs 校验 | [After](after/auth-recover-390x844.png) |
| Recover | 1024x768 | [Before](before/auth-recover-1024x768.png) | 以 1440 Target + specs 校验 | [After](after/auth-recover-1024x768.png) |
| Recover | 1440x900 | [Before](before/auth-recover-1440x900.png) | `pub_recover-1440x900.png` | [After](after/auth-recover-1440x900.png) |
| Callback | 320x640 | [Before](before/auth-callback-320x640.png) | Login PublicShell geometry + formal Callback specs | [After](after/auth-callback-320x640.png) |
| Callback | 390x844 | [Before](before/auth-callback-390x844.png) | `pub_login-390x844.png` geometry | [After](after/auth-callback-390x844.png) |
| Callback | 1024x768 | [Before](before/auth-callback-1024x768.png) | Login PublicShell geometry + formal Callback specs | [After](after/auth-callback-1024x768.png) |
| Callback | 1440x900 | [Before](before/auth-callback-1440x900.png) | `pub_login-1440x900.png` geometry | [After](after/auth-callback-1440x900.png) |

### Onboarding

| 视口 | Before | GLM Target | After |
| --- | --- | --- | --- |
| 320x640 | 无可信旧正式七步证据 | 以 390 Target + specs 校验 | [After](after/onboarding-320x640.png) |
| 390x844 | [Before](before/onboarding-390x844.png) | `pub_onboarding-390x844.png` | [After](after/onboarding-390x844.png) |
| 1024x768 | 无可信旧正式七步证据 | 以 1440 Target + specs 校验 | [After](after/onboarding-1024x768.png) |
| 1440x900 | [Before](before/onboarding-1440x900.png) | `pub_onboarding-1440x900.png` | [After](after/onboarding-1440x900.png) |

旧 Onboarding Web 依赖已移除的 `/api/v1/auth/session`，当前正式 API 使用 `/auth/me`。因此旧镜像只能留下匿名 Session 状态的 390/1440 截图，无法诚实重放旧七步流程；没有通过 mock、代理或兼容端点伪造 320/1024 Before。

## 主体结构差异

### Before

```text
Auth
├─ 全宽公共 Header
├─ 装饰视觉大面板
└─ 旧表单列
   ├─ 超大页面标题
   ├─ Credentials 纵向平铺
   └─ Passkey / Recover / Register 松散分布

Callback
└─ Generic session-state page

Onboarding
├─ Sidebar card：步骤和上下文
└─ Content card：当前表单
   └─ 页面套页面、上下文返回后容易丢失
```

### After

```text
Public Flow
├─ Compact brand / theme utility
└─ Focused workspace
   ├─ Auth 440px PublicShell
   │  ├─ Identity / policy / token state
   │  ├─ Current credentials or recovery task
   │  └─ Persistent recovery path
   ├─ Callback transient status + retry/login recovery
   └─ Onboarding 620px workspace
      ├─ Seven-step progress
      ├─ Persistent Persona / Workspace / Space / Vault context
      ├─ Current step editor
      └─ Back / state feedback / one primary
```

旧装饰视觉、粗边框和大块空白被移除。Auth 只保留当前认证任务；Onboarding 仍保留七步正式功能，但上下文不再藏在子组件临时状态里，返回后 Persona、Workspace 和 Space 选择持续回填。

## 主任务与组件映射

| 路由 | 主任务 / 唯一 primary | 正式区域 | 组件表达 |
| --- | --- | --- | --- |
| Login | 建立设备 Session / 登录 | Identity、Credentials、Recovery | PublicShell、可见 label、密码可见按钮、Passkey secondary、账户帮助 links |
| Register | 按当前部署策略注册 / 创建账号或使用邀请 | Policy、Form、Recovery | 紧凑 policy state、privacy-safe feedback、request ID recovery |
| Verify | 消费 fragment token 并设置密码 / 验证并继续 | Token state、Credentials、Recovery | fragment guard、password/confirmation、invalid-link recovery |
| Recover | 请求或完成密码恢复 / 当前阶段继续 | Form、Privacy feedback、Exit | 两阶段 inline form、TOTP/recovery code 二级披露、全局 Session 撤销说明 |
| Callback | 自动决定 Today 或 Onboarding / 自动完成 | Status、Recovery | PublicShell transient state、retry、login recovery |
| Onboarding | 建立首次使用上下文 / 当前步骤继续 | Progress、Step、Context、Recovery | 七步 stepper、Choice、Inline form、Lucide persona icons、persistent context、back |

## Function Reachability

| 正式能力 | 新入口 | 验证 |
| --- | --- | --- |
| 密码登录与设备命名 | Login Credentials | `autocomplete=email/current-password`、可编辑设备名、正式 Cookie Session |
| Password manager / paste / visibility | Login password field | paste 未阻止；显示/隐藏按钮有精确可访问名称 |
| MFA TOTP / recovery code | Login MFA choice | challenge、method choice、取消返回均保留 |
| Passkey | Login secondary action | capability、challenge/verify、错误恢复保留；无新路由 |
| Invite/open/closed registration policy | Register policy region | 当前 production invite 状态真实显示；隐私等价反馈保留 |
| Email verification | Verify credentials | fragment token 读取和清除、12 字符密码、确认匹配、失败恢复保留 |
| Password recovery | Recover request/completion | privacy-equal request、fragment completion、可选 MFA、Session revoke 保留 |
| Callback success | 完成 Onboarding 后访问 Callback | 真实 settings 读取并回到 `/app/today` |
| Callback failure | 匿名访问 Callback | retry 与返回登录均可达 |
| Persona | Onboarding step 1 | 四种正式 Persona ID 和保存副作用保留；结构图标改用 Lucide |
| Workspace / Space | Onboarding steps 2-3 | 创建、选择、返回后回填均通过真实 API |
| Vault | Onboarding step 4 | 本机 passphrase 与确认逻辑保留 |
| Template | Onboarding step 5 | 可跳过项保持明确可发现 |
| First Goal | Onboarding step 6 | 目标、完成条件、每周分钟真实创建；防重复完成 |
| Completion | Onboarding step 7 | 设置完成并进入 Today；App Shell ready 后 Callback 回归通过 |

全部正式入口仍可发现，Function Reachability 为 100%。

## 状态、响应式与无障碍

- Auth 使用真实 controller 呈现 idle、pending、success、privacy-safe error、request ID、MFA、Passkey capability-disabled、invalid/expired fragment 与 retry；不适用于认证语义的 Vault locked、sync stale 等状态没有伪造。
- Callback success、settings unavailable、retry 与 login recovery 均有独立视觉和恢复动作。
- Onboarding pending、save error、disabled、return、optional skip 和 completion 均有明确反馈；创建 Workspace/Space 后返回不会丢选择。
- 320、390、1024、1440：无横向 overflow、遮挡或不可达操作；移动端允许自然纵向滚动。
- 每个可见交互层 `data-workbench-primary="true"` 不超过 1。
- 五个公共浏览器项目对 `/`、五条 Auth 路由和 `/offline` 的 Axe WCAG 2.2 AA、regions、320px overflow、theme bootstrap、reduced-motion 均通过。
- Chromium/Firefox 的自动键盘顺序通过；WebKit link tabbing 与物理移动键盘按测试合同保留人工验收，因此 7 项显式 skip，不是失败或静默豁免。
- Skip link、可见 focus、语义 heading、form label、错误 recovery 与 live alert 保留。
- `ui-ux-pro-max` 复核 accessible authentication、错误恢复、44px 移动触达和结构图标规范；Onboarding 四个 emoji 结构图标已替换为现有 `AppIcon`。

## Target SHA-256

| Target | SHA-256 |
| --- | --- |
| `pub_login-390x844.png` | `5cb5ec5af6f5375f02fac2cfde26c2734c446c3ba7a95774f6d0cfcfecb1f980` |
| `pub_login-1440x900.png` | `86e70d2fc5e4220a901dad69af0b33e94d95ed227316f031bb5d3bd2edb378bf` |
| `pub_register-invite-390x844.png` | `65e3735bd26867659af5798e144e566f7fe15d49520c4a9612b1192cbba80920` |
| `pub_register-open-1440x900.png` | `0beb31388c1b7bbc7bcf9f43ac8bae59b5500a3fe117bce189a5f8dadb8a205e` |
| `pub_register-invite-1440x900.png` | `a64452b9944e5b60181e7ef9dbd84f456f0f9d10e9da0dd3b4763f10f2acd4da` |
| `pub_register-closed-1440x900.png` | `1eeae9ff82b94a077350f676517e849d797a808fd7ebcdd1c2ae427894ab5f91` |
| `pub_verify-1440x900.png` | `107a15bd536b8c5ee478be402779f31026cf07a9baa64aa777515dce1944870a` |
| `pub_recover-1440x900.png` | `e39670aaa6bc0ed68ae31cdccf8e85b048a2a003e42c08d5f2cbea102f6b5de9` |
| `pub_onboarding-390x844.png` | `2f2eca1910496b34b3d46017845aee4d36e59abb19a42522d5afffc9dcfe4aec` |
| `pub_onboarding-1440x900.png` | `951dfcc7f458d2a644e16dda5a81af15813f9d71526bb5ce700da2f91e02f29c` |

## Before SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `auth-callback-1024x768.png` | `b2bda495d8d2668dbbfa086d42192251a349614c2502000f7d9b32cc73c01abb` |
| `auth-callback-1440x900.png` | `3aa14ef4bd1137116f1b07e44e131cc910f1f98f2dfae6cedf90430178fbcdcf` |
| `auth-callback-320x640.png` | `eb3605a47413cc1daca6030d138a157783089e8051e4e85a728d4c645ab8d678` |
| `auth-callback-390x844.png` | `b8fde379be46d7565a168c4863b7616930153b14c67ab82d55ee75e39250bed6` |
| `auth-login-1024x768.png` | `f2953acd5cafd0cfa7be86557a639815cbfbcc9b5dcdb2f69cc106e427efee84` |
| `auth-login-1440x900.png` | `ec9f370db862c2d0af4fbc6e50561c6f5ff0a7b9e3762e7fcaffe606a80f1799` |
| `auth-login-320x640.png` | `7a40e1d0035609067d7a6ec25a57208730d020467857a657ca1633735971c8cf` |
| `auth-login-390x844.png` | `51041dd91a0114a297cc0a5a8b96a526ca92a2f99f8c83bb8cf3aa992a8b5642` |
| `auth-recover-1024x768.png` | `15fabd2d2aed9dddf695b67b2522d46e8a8d244f41901f60da72c40c6a3a3d89` |
| `auth-recover-1440x900.png` | `640e62fea1841945690060b7597f72e26d9b16d1177390d36b0420be8eb5a50a` |
| `auth-recover-320x640.png` | `603f76711d6539f0d73c5a11b5279149b539b875b7b4e5aa374596f24730e7b7` |
| `auth-recover-390x844.png` | `d167444625d6d702961a9cc884c12ca0c9de2e11817e89a7b52fab7a86a448e3` |
| `auth-register-1024x768.png` | `7a200c6e45ef409b1ff6eddb4cc514d98c4d14b4c7d94b649c69f6f6fe9745ca` |
| `auth-register-1440x900.png` | `8bbbf6e3c59b281e20ad91b02b27b8a00f900db1c0636b4e8a58f26f264cbd07` |
| `auth-register-320x640.png` | `727d40673fcd3ce83792f190a58337483ef672fd76c3df034d5bdda27cc7a863` |
| `auth-register-390x844.png` | `45b04ba60c388f276e00b97ed0867edaf2cfebdda2833133ea24433d3cd97d51` |
| `auth-verify-1024x768.png` | `76d40a85f7b3da909639dc5e37c30c1281913a9352bc65023f91e4ef076aacad` |
| `auth-verify-1440x900.png` | `2b765955db2a5d76793d06c3f96677fcd43a815928f4069c48f485b0741a0e2e` |
| `auth-verify-320x640.png` | `942d319daf99d48f5b12b05c0ec1e54ab9ac291f52ef8a5d01b57594f92a8b2f` |
| `auth-verify-390x844.png` | `ddbe33037e99a2207426166c3e9ab3a9e0fd7efc71e277a7f2ecf5ec57ade1e6` |

## After SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `auth-callback-1024x768.png` | `16f615cc8b223343f8802eea29781d777346f37bfa93518270994d7be345fad9` |
| `auth-callback-1440x900.png` | `182c738b6053346628dd4a8f493e866b411b77a63552d49d88fc0f525ed55035` |
| `auth-callback-320x640.png` | `14ba228d6ce889ea833190c8d56dec95c16ba87c09d6373d961aa3e726fb1b25` |
| `auth-callback-390x844.png` | `68dda9a93ffc8b8e8c47d78e605fec390357834f3c9cf202f5e744de1ee7b6c7` |
| `auth-login-1024x768.png` | `0e59afbd72b19eb220b06346e5a43b5fa6d00f35a3c7d6727664df59918434cb` |
| `auth-login-1440x900.png` | `4299be10194be9bf60587f3f08eea484adb664bf540b0a602b1bbc05c19dc053` |
| `auth-login-320x640.png` | `1c7a69dc22d691dbb6e5103e41974a9deacd1265d4c1b63f0bc5b891cd135473` |
| `auth-login-390x844.png` | `cd4586539a37a768d1486dcee99ebb55fa2c7da6450b8e486ce931a3e6526c98` |
| `auth-recover-1024x768.png` | `a5ba4d4799cabd1327bcd3f673c4576f09daa49d6b8a82d8322faba0cefe3649` |
| `auth-recover-1440x900.png` | `f00ae04c658fa7acd8aad63a77676a583a38a62ec0dc60fba25a158e31124364` |
| `auth-recover-320x640.png` | `dabe9a7de4593340647ec9ec9b763bc19c35e563788cd27a27c4889f95fec0f7` |
| `auth-recover-390x844.png` | `6c992fcbdb4622ce7bc5571229fe11754cc742fa37816954788b1960767d2b9b` |
| `auth-register-1024x768.png` | `5311a42e78784c34a0d4748ea8b29e3ef109d2d9b2f468dac0be7684a6822995` |
| `auth-register-1440x900.png` | `dbdc2241c3fd3ddb1ef70420a410b0de14976f892ed1b79d8a38910b1ca92520` |
| `auth-register-320x640.png` | `551eec4e5d4df15552c1d42fb2827e3a24a0f6f95f3f80ca8b479ba86b7bde29` |
| `auth-register-390x844.png` | `b50e16985e39313ac80f2da80af2388e22f2a1b25949a3ec6ac35577b1998774` |
| `auth-verify-1024x768.png` | `51cfbf4e23be22b1147978843033c27fe93cce97a3a584a65d6d75b11a93ed31` |
| `auth-verify-1440x900.png` | `d63d7dd34e570a2adf8ade300dfe8a4fddeb7e732ac2c8abd52f5e1657f682ca` |
| `auth-verify-320x640.png` | `e4137f9d178d5738505bf055a72a8af2f9c5957599a49915698e7c501b42f495` |
| `auth-verify-390x844.png` | `0a1e2e58e331ad4e9036f92a5195dad1f05142d29e380506e079a57616032bf0` |
| `onboarding-1024x768.png` | `e4f8abdffee250bcbb02e8eadd87d381b08d3ac10340eb7d754463c16c3cfe1a` |
| `onboarding-1440x900.png` | `be9fb8d2c563c79a11c889ae4d536dfbabf4c6725620bc28a672901e9127095a` |
| `onboarding-320x640.png` | `3b018a230ab32284ae8ddf01da77ca06bd2a56ae88e3b55c3ee819cc555ab3c7` |
| `onboarding-390x844.png` | `4bd2d1e82ff2c241c0b9383b6a626ead3e63256067ae3113fe6f0810ceb85449` |

## 验证记录

```text
pnpm --filter @logion/web test       50 files / 194 tests passed
pnpm --filter @logion/web typecheck  passed
pnpm --filter @logion/web lint       passed
pnpm exec prettier --check ...       passed
docker production build              35 routes built
git diff --check                     passed

auth-public-flow.spec.ts             2 passed
public-accessibility + auth-public   125 passed / 7 explicit skips / 2.9m
```

真实七步 E2E 在正式 `8080` Session/API 下完成 Persona、Workspace、Space、Vault、Template skip、Goal 与 Today，并在 Today App Shell ready 后验证 Callback 成功分支。Callback 失败分支、password manager、paste、visibility、键盘、focus、Axe、reduced-motion、四断点和截图均来自同一最终镜像。

## 额外全套诊断与后续约束

本轮还额外运行了全部 `authenticated-chromium` 项目，结果为 `26 passed / 9 failed / 3 did not run`。Auth 本身两项通过；失败集中在三类父计划回归债：

1. `persona-system` 的旧测试直接调用 legacy `/api/v1/auth/register`，与当前正式 `invite` 策略的预期 `410` 冲突。
2. 显式复用单一 E2E 账号时，Persona/Vault 服务端状态会在串行 spec 间污染；正式隔离账号夹具在 invite 模式下不能使用 legacy provision。
3. 已批准样板的 dark theme 中，`#4a75e0` 用于小字、active nav 和部分背景时存在 2.98:1-4.27:1 对比度失败；另有 disabled primary 组合失败。

这些失败不是 Auth PublicShell 或本次 Callback 竞态修复造成，但会阻止父计划最终发布 Gate。后续必须把 legacy 注册测试迁移到正式 invitation/email-verification fixture、恢复 worker 级账号隔离，并成对校准 light/dark interaction tokens；不得通过关闭 Axe、放宽 Callback `401` 或隐藏功能处理。

## 偏离与审批

| 项目 | 原因 | 替代方案 | 状态 |
| --- | --- | --- | --- |
| 不创建 `/auth/passkey` | 正式 Passkey 是 Login 方法，不是路由 | 在 Login secondary action 内保留 capability 与 recovery | 已由整改计划批准 |
| Callback 复用 Login Target 几何 | GLM 无独立 Callback Target | 使用 PublicShell + 正式 transient/retry/login recovery | 已由整改计划批准 |
| 正式七步覆盖原型顺序 | API、Vault、Workspace、Space、Goal 是行为真相源 | 保留 GLM stepper 层级，不复制 fixture | 已由整改计划批准 |
| 移动目标至少 44x44px | WCAG 和触达质量 | 只扩大点击区，不改变信息层级 | 已由整改计划批准 |
| Onboarding Before 只有 390/1440 匿名态 | 旧 Web 与当前 API Session 合同不兼容 | 明确证据缺口，不 mock、不伪造 | 待 PO 知悉 |

Auth、Callback 与 Onboarding 当前状态为“实现及 AI 自检完成”。父计划继续进入步骤 8；最终 Product Owner Gate 仍需按真实任务确认视觉层级和目标流程。
