# 前端路由与画像导航

## 应用边界

`/app/*` 由认证布局统一包裹：

1. `SessionBoundary` 验证受保护 Cookie 会话。
2. `PersonaProvider` 从用户设置 API 加载画像。
3. `VaultSessionProvider` 管理本地加密资料状态。
4. `AppShell` 渲染导航和页面内容。

`/onboarding` 使用独立的认证布局，并复用同一个 `PersonaProvider`，因此第 1 步保存后进入应用时会从服务端读取同一画像。

## 画像路由守卫

`PersonaProvider` 提供 `isRouteVisible(route)` 判断路由是否应出现在当前画像的界面中。

- 侧边栏、移动导航和命令面板只渲染可见入口。
- `/app/today` 使用同一画像映射展示优先入口和快速切换器，但真实任务、会话和证据数据仍由统一的 `TodayCenter` 提供。
- 加载画像期间暂时保留全部入口，避免错误隐藏和界面闪断。
- 采用软守卫：直接访问未显示的页面不会被重定向。
- API 不读取画像，也不根据画像做授权；工作区与空间权限继续由后端权限模型判断。

预设映射集中在 `apps/web/src/features/personas/persona-definitions.ts`。自定义画像的路由只能来自同文件的 `ALL_ROUTES` 白名单。

## 首次登录

密码、MFA 与 Passkey 登录成功后统一读取 `onboarding_completed`：

- 值为 `"true"`：进入 `/app/today`。
- 不存在或不是 `"true"`：进入 `/onboarding`。
- 设置服务暂时不可用：降级进入 `/app/today`，避免因偏好服务故障锁死已认证用户。

完成 8 步引导后，前端通过现有 UserSetting PUT 写入 `onboarding_completed: "true"`。
